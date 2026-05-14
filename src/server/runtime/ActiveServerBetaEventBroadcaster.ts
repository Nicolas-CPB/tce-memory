// SPDX-License-Identifier: Apache-2.0

import type { Response } from 'express';
import { logger } from '../../utils/logger.js';
import type { ServerBetaBoundaryHealth, ServerBetaEventBroadcaster } from './types.js';

export class ActiveServerBetaEventBroadcaster implements ServerBetaEventBroadcaster {
  readonly kind = 'event-broadcaster' as const;
  private clients: Set<Response> = new Set();

  getHealth(): ServerBetaBoundaryHealth {
    return {
      status: 'active',
      reason: 'SSE broadcaster is running',
      details: {
        connectedClients: this.clients.size,
      },
    };
  }

  addClient(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    this.clients.add(res);
    logger.debug('SYSTEM', 'SSE client connected', { total: this.clients.size });

    res.on('close', () => {
      this.clients.delete(res);
      logger.debug('SYSTEM', 'SSE client disconnected', { total: this.clients.size });
    });

    // Send connection success
    this.sendToClient(res, { type: 'connected', timestamp: Date.now() });
  }

  broadcast(event: any): void {
    if (this.clients.size === 0) return;

    const data = `data: ${JSON.stringify({ ...event, timestamp: Date.now() })}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(data);
      } catch (err) {
        logger.warn('SYSTEM', 'Failed to write to SSE client, removing', { err });
        this.clients.delete(client);
      }
    }
  }

  async close(): Promise<void> {
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();
  }

  private sendToClient(res: Response, event: any): void {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      this.clients.delete(res);
    }
  }
}
