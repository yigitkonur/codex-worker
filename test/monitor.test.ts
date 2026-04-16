import test from 'node:test';
import assert from 'node:assert/strict';

import { formatMonitorEvent } from '../src/monitor.js';

test('monitor formats steer, command completion, and task completion from raw envelopes', () => {
  const events = [
    { ts: '2026-04-15T00:00:00.000Z', dir: 'rpc_out', method: 'turn/steer', params: { threadId: 'thread-1' } },
    { ts: '2026-04-15T00:00:01.000Z', dir: 'notification', method: 'item/completed', params: { item: { type: 'commandExecution', command: 'git status' } } },
    { ts: '2026-04-15T00:00:02.000Z', dir: 'daemon', message: 'completeExecution status=completed turnId=turn-1' },
  ];

  const rendered = events.map((entry) => formatMonitorEvent(entry)).filter(Boolean);
  assert.deepEqual(rendered, [
    '<<CODEX>> steer_requested thread=thread-1',
    '<<CODEX>> command_executed command="git status"',
    '<<CODEX>> task_complete turn=turn-1',
  ]);
});

test('monitor formats approvals and questions from server requests', () => {
  const approval = formatMonitorEvent({
    dir: 'server_request',
    id: 'req-1',
    method: 'item/commandExecution/requestApproval',
  });
  const question = formatMonitorEvent({
    dir: 'server_request',
    id: 'req-2',
    method: 'item/tool/requestUserInput',
  });

  assert.equal(approval, '<<CODEX>> approval method=item/commandExecution/requestApproval id=req-1');
  assert.equal(question, '<<CODEX>> question id=req-2');
});
