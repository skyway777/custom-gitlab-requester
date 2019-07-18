import Ky from 'ky-universal';
import FormData from 'form-data';
import { decamelizeKeys } from 'humps';
import { stringify } from 'query-string';
import https from 'https';
import fs from 'fs';


export function skipAllCaps(key, convert, options) {
    return /^([A-Z0-9])+_*/.test(key) ? key : convert(key, options);
}

  
const methods = ['get', 'post', 'put', 'delete', 'stream'];
const KyRequester = {};

function responseHeadersAsObject(response) {
    const headers = {};
    const keyVals = [...response.headers.entries()];

    keyVals.forEach(([key, val]) => {
        headers[key] = val;
    });

    return headers;
}

function readKey(path) {
    if (!path) {
        return;
    }
    try {
        return fs.readFileSync(path);
    }
    catch(e) {
        throw(`Error while reading file: ${path}. Error ${e}`);
    }
}

function buildAgent() {
    const { GITLAB_SSL_KEY, GITLAB_SSL_CERT } = process.env;

    if (GITLAB_SSL_KEY || GITLAB_SSL_CERT) {
        const key = readKey(GITLAB_SSL_KEY);
        const cert = readKey(GITLAB_SSL_CERT);

        return new https.Agent({
            key,
            cert,
        })
    }
    return;
}

function defaultRequest(service: any, { body, query, sudo, method }) {
    const headers = new Headers(service.headers);
    let bod = body;
    
    const agent = buildAgent();

    if (sudo) headers.append('sudo', `${sudo}`);

    if (typeof body === 'object' && !(body instanceof FormData)) {
        bod = JSON.stringify(decamelizeKeys(body, skipAllCaps));
        headers.append('content-type', 'application/json');
    }

    return {
        timeout: service.requestTimeout,
        headers,
        method: method === 'stream' ? 'get' : method,
        onProgress: method === 'stream' ? () => { } : undefined,
        searchParams: stringify(decamelizeKeys(query || {}) as any, { arrayFormat: 'bracket' }),
        prefixUrl: service.url,
        body: bod,
        agent
    };
}

async function processBody(response) {
    const contentType = response.headers.get('content-type') || '';
    const content = await response.text();

    if (contentType.includes('json')) {
        try {
            return JSON.parse(content || '{}');
        } catch {
            return {};
        }
    }

    return content;
}

methods.forEach(m => {
    KyRequester[m] = async function (service, endpoint, options) {
        const requestOptions = defaultRequest(service, { ...options, method: m });
        let response;

        try {
            response = await Ky(endpoint, requestOptions);
            console.log('response: ', response);
        } catch (e) {
            if (e.response) {
                const output = await e.response.json();

                e.description = output.error || output.message;
            }

            throw e;
        }

        const { status } = response;
        const headers = responseHeadersAsObject(response);
        const body = await processBody(response);

        return { body, headers, status };
    };
});

export { KyRequester };
