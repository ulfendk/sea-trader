import express from 'express';
import { matchMaker } from '@colyseus/core';
import fs from 'node:fs';
import path from 'node:path';
import { apiRouter } from './api.js';
import { config } from './config.js';

/**
 * Colyseus answers preflights and sets CORS headers for every HTTP request (API and matchmaking),
 * so the allow-list is applied there. Auth uses bearer tokens, never cookies.
 */
function configureCors() {
  const allowed = new Set(config.corsOrigins);
  try {
    allowed.add(new URL(config.publicUrl).origin);
  } catch {
    /* ignore invalid PUBLIC_URL */
  }
  const ctrl = matchMaker.controller;
  delete (ctrl.DEFAULT_CORS_HEADERS as Record<string, string>)['Access-Control-Allow-Origin'];
  delete (ctrl.DEFAULT_CORS_HEADERS as Record<string, string>)['Access-Control-Allow-Credentials'];
  ctrl.getCorsHeaders = (headers: Headers): Record<string, string> => {
    const origin = headers.get('origin');
    if (origin && (allowed.has(origin) || allowed.has('*')))
      return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
    return { Vary: 'Origin' };
  };
}

/** Configures the Express app that Colyseus' transport exposes. */
export function configureApp(app: express.Application) {
  if (config.trustProxy)
    app.set(
      'trust proxy',
      /^\d+$/.test(config.trustProxy)
        ? Number(config.trustProxy)
        : config.trustProxy === 'true'
          ? true
          : config.trustProxy,
    );
  app.disable('x-powered-by');
  configureCors();
  app.use('/api', apiRouter());

  if (config.serveWeb && fs.existsSync(path.join(config.webDist, 'index.html'))) {
    app.use(
      express.static(config.webDist, {
        index: false,
        setHeaders(res, file) {
          if (file.endsWith('sw.js') || file.endsWith('.webmanifest') || file.endsWith('index.html'))
            res.setHeader('Cache-Control', 'no-cache');
          else if (file.includes(`${path.sep}assets${path.sep}`))
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    const index = fs.readFileSync(path.join(config.webDist, 'index.html'));
    app.get(/^\/(?!api\/|matchmake\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(index);
    });
    console.log(`Serving web app from ${config.webDist}`);
  }
}
