import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { apiRouter } from './api.js';
import { config } from './config.js';

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
  const allowed = new Set(config.corsOrigins);
  app.use(
    '/api',
    cors({
      origin: (origin, cb) => cb(null, !origin || allowed.has(origin) || allowed.has('*')),
      allowedHeaders: ['Authorization', 'Content-Type'],
      maxAge: 86400,
    }),
  );
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
