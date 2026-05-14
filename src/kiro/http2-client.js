const http2 = require('http2');
const { URL } = require('url');

const sessions = new Map();

function getSession(origin) {
  if (sessions.has(origin)) {
    const s = sessions.get(origin);
    if (!s.closed && !s.destroyed) return s;
    sessions.delete(origin);
  }
  const session = http2.connect(origin);
  session.on('error', () => { sessions.delete(origin); });
  session.on('close', () => { sessions.delete(origin); });
  session.setTimeout(720000, () => { session.close(); sessions.delete(origin); });
  sessions.set(origin, session);
  return session;
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const origin = parsed.origin;
    const path = parsed.pathname + parsed.search;

    let session;
    try {
      session = getSession(origin);
    } catch (e) {
      return reject(e);
    }

    const headers = {
      ':method': options.method || 'POST',
      ':path': path,
      ':scheme': parsed.protocol.replace(':', ''),
      ':authority': parsed.host,
      ...options.headers,
    };

    // Remove headers that conflict with HTTP/2 pseudo-headers
    delete headers['host'];
    delete headers['Host'];
    delete headers['connection'];
    delete headers['Connection'];

    const req = session.request(headers);
    req.setTimeout(720000, () => { req.close(); reject(new Error('HTTP/2 request timeout')); });

    const chunks = [];
    let responseHeaders = null;

    req.on('response', (hdrs) => {
      responseHeaders = hdrs;
    });

    req.on('data', (chunk) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      const status = responseHeaders[':status'];
      const body = Buffer.concat(chunks);
      resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: responseHeaders,
        text: () => Promise.resolve(body.toString('utf8')),
        body,
        rawBody: body,
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function requestStream(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const origin = parsed.origin;
    const path = parsed.pathname + parsed.search;

    let session;
    try {
      session = getSession(origin);
    } catch (e) {
      return reject(e);
    }

    const headers = {
      ':method': options.method || 'POST',
      ':path': path,
      ':scheme': parsed.protocol.replace(':', ''),
      ':authority': parsed.host,
      ...options.headers,
    };

    delete headers['host'];
    delete headers['Host'];
    delete headers['connection'];
    delete headers['Connection'];

    const req = session.request(headers);
    req.setTimeout(720000, () => { req.close(); reject(new Error('HTTP/2 stream timeout')); });

    req.on('response', (hdrs) => {
      const status = hdrs[':status'];
      if (status >= 200 && status < 300) {
        resolve({ ok: true, status, headers: hdrs, stream: req });
      } else {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            ok: false,
            status,
            headers: hdrs,
            text: () => Promise.resolve(body),
            body,
          });
        });
      }
    });

    req.on('error', (e) => {
      reject(e);
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function closeAll() {
  for (const [, session] of sessions) {
    session.close();
  }
  sessions.clear();
}

module.exports = { request, requestStream, closeAll };
