/**
 * Pull requests do not exist locally: the list is empty, no blueprint has an
 * open PR, and the setup-flow PR polling answers 404 (that UI branch is
 * unreachable because the local scaffold never opens a PR).
 */

import { Hono } from 'hono';
import type { BlueprintPullRequestStatus, PullRequestResponse } from '@shared/api-types';
import type { AppContext } from '../context';
import { HttpError } from '../errors';

export function pullRequestRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  app.get('/:owner/:repo/pull-requests', (c) => {
    ctx.registry.requireRepository(c.req.param('owner'), c.req.param('repo'));
    const empty: PullRequestResponse[] = [];
    return c.json(empty);
  });
  app.get('/:owner/:repo/blueprints/:name/pull-request-status', (c) => {
    const repository = ctx.registry.requireRepository(c.req.param('owner'), c.req.param('repo'));
    ctx.registry.requireBlueprint(repository.id, c.req.param('name'));
    const status: BlueprintPullRequestStatus = { open_pr_number: null };
    return c.json(status);
  });
  app.get('/:owner/:repo/pulls/:number', () => {
    throw new HttpError(404, 'Pull requests are not available in Fuse Desktop.', 'http_404');
  });
  app.post('/:owner/:repo/pulls/:number/close', () => {
    throw new HttpError(404, 'Pull requests are not available in Fuse Desktop.', 'http_404');
  });
  return app;
}
