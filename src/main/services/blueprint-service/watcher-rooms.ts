import type { AppContext } from '../../server/context';
import { BlueprintWatcher, type BlueprintWatcherOptions } from '../blueprint-watcher';
import type { OpenProject } from '../types';

const WATCHER_IDLE_MS = 15_000;
const SYNC_PUBLISH_DEBOUNCE_MS = 400;

export interface WatchedRoomIdentity {
  owner: string;
  repo: string;
  blueprintId: string;
}

interface RoomState extends WatchedRoomIdentity {
  watcher: BlueprintWatcher;
  subscribers: number;
  stopTimer: NodeJS.Timeout | null;
  publishTimers: Map<string, NodeJS.Timeout>;
}

type WatcherTuning = Pick<BlueprintWatcherOptions, 'debounceMs' | 'pollIntervalMs' | 'forcePolling'>;

export class BlueprintWatcherRooms {
  private readonly rooms = new Map<string, RoomState>();

  constructor(
    private readonly ctx: AppContext,
    private readonly watcherOptions: () => WatcherTuning,
    private readonly onExternalChange: (room: WatchedRoomIdentity, changed: string[]) => Promise<void>,
  ) {}

  retain(project: OpenProject, files: readonly string[]): () => void {
    const room = this.rooms.get(project.roomKey) ?? this.startRoom(project, files);
    if (room.stopTimer) {
      clearTimeout(room.stopTimer);
      room.stopTimer = null;
    }
    room.subscribers += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      room.subscribers -= 1;
      if (room.subscribers > 0 || this.rooms.get(project.roomKey) !== room) return;
      room.stopTimer = setTimeout(() => {
        if (this.rooms.get(project.roomKey) === room) this.stop(project.roomKey);
      }, WATCHER_IDLE_MS);
      room.stopTimer.unref();
    };
  }

  setFiles(roomKey: string, files: readonly string[]): void {
    this.rooms.get(roomKey)?.watcher.setFiles(files);
  }

  noteOwnWrite(roomKey: string, relative: string, content: string | Buffer): void {
    this.rooms.get(roomKey)?.watcher.noteOwnWrite(relative, content);
  }

  isWatching(roomKey: string): boolean {
    return this.rooms.get(roomKey)?.watcher.isRunning ?? false;
  }

  publishDebounced(project: OpenProject, event: string, data: unknown, delayMs = SYNC_PUBLISH_DEBOUNCE_MS): void {
    const room = this.rooms.get(project.roomKey);
    if (!room) {
      this.publish(project, event, data);
      return;
    }
    const existing = room.publishTimers.get(event);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      room.publishTimers.delete(event);
      this.publish(project, event, data);
    }, delayMs);
    timer.unref();
    room.publishTimers.set(event, timer);
  }

  stop(roomKey: string): void {
    const room = this.rooms.get(roomKey);
    if (!room) return;
    if (room.stopTimer) clearTimeout(room.stopTimer);
    for (const timer of room.publishTimers.values()) clearTimeout(timer);
    room.watcher.stop();
    this.rooms.delete(roomKey);
  }

  shutdown(): void {
    for (const key of [...this.rooms.keys()]) this.stop(key);
  }

  private startRoom(project: OpenProject, files: readonly string[]): RoomState {
    const identity: WatchedRoomIdentity = {
      owner: project.repository.owner,
      repo: project.repository.name,
      blueprintId: project.blueprint.id,
    };
    const room: RoomState = {
      ...identity,
      watcher: new BlueprintWatcher({
        clonePath: project.clonePath,
        ...this.watcherOptions(),
        onChange: (changed) => this.onExternalChange(identity, changed),
        onWarning: (message, error) => console.warn(`[blueprints] ${message}`, error ?? ''),
      }),
      subscribers: 0,
      stopTimer: null,
      publishTimers: new Map(),
    };
    this.rooms.set(project.roomKey, room);
    room.watcher.setFiles(files);
    room.watcher.start();
    return room;
  }

  private publish(project: OpenProject, event: string, data: unknown): void {
    this.ctx.blueprintRooms.get(project.roomKey).publish(event, data);
  }
}
