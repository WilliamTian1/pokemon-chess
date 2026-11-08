/// <reference lib="webworker" />
import { seededRng } from '../engine';
import { decide } from './bot';
import type { BotRequest, BotResponse } from './client';

self.onmessage = (e: MessageEvent<BotRequest>) => {
  const { id, state, side, level, seed } = e.data;
  let res: BotResponse;
  try {
    res = { id, actions: decide(state, side, level, seededRng(seed)) };
  } catch (err) {
    res = { id, actions: [], error: String(err) };
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(res);
};
