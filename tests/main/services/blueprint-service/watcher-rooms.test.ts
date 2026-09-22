import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SseFrame } from '@main/server/sse';
import { BlueprintWatcherRooms } from '@main/services/blueprint-service/watcher-rooms';
import { createTestContext, type TestContext } from '@test/main/services/workspace/test-context';
import { createProject } from './test-project';

let test: TestContext;
let rooms: BlueprintWatcherRooms;

beforeEach(() => {
  test = createTestContext();
  rooms = new BlueprintWatcherRooms(test.ctx, () => ({ forcePolling: true, pollIntervalMs: 20 }), vi.fn(async () => undefined));
});

afterEach(() => {
  rooms.shutdown();
  test.cleanup();
});

describe('BlueprintWatcherRooms', () => {
  it('reuses a live room and stale releases cannot stop it after explicit teardown', () => {
    const project = createProject(test, 'docs/main.tex');
    const firstRelease = rooms.retain(project, ['docs/main.tex']);
    rooms.retain(project, ['docs/main.tex']);
    expect(rooms.isWatching(project.roomKey)).toBe(true);
    rooms.stop(project.roomKey);
    firstRelease();
    expect(rooms.isWatching(project.roomKey)).toBe(false);
  });

  it('coalesces matching events and publishes immediately without a retained room', async () => {
    const project = createProject(test);
    const frames: SseFrame[] = [];
    test.ctx.blueprintRooms.get(project.roomKey).subscribe((frame) => {
      if (frame) frames.push(frame);
    });
    rooms.publishDebounced(project, 'blueprint_sync', { value: 1 });
    expect(frames).toHaveLength(1);
    rooms.retain(project, []);
    rooms.publishDebounced(project, 'blueprint_sync', { value: 2 }, 5);
    rooms.publishDebounced(project, 'blueprint_sync', { value: 3 }, 5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(frames.map((frame) => frame.data)).toEqual([{ value: 1 }, { value: 3 }]);
  });
});
