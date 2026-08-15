import React from 'react';
import { Box, useInput } from 'ink';
import { DshAgentController, DshSharedSessionStore } from '@dsh-community/dsh-bridge';
import { useTuiBridge } from './adapter/tui-adapter.js';
import { Header } from './views/Header.js';
import { MessageList } from './views/MessageList.js';
import { ReasoningBox } from './views/ReasoningBox.js';
import { ApprovalPrompt } from './views/ApprovalPrompt.js';
import { InputBar } from './views/InputBar.js';

interface AppProps {
  controller: DshAgentController;
}

export const App: React.FC<AppProps> = ({ controller }) => {
  const {
    session,
    status,
    currentReasoning,
    currentContent,
    pendingApproval,
    metrics,
    submitPrompt,
    respondApproval,
    interrupt,
    rollback,
  } = useTuiBridge(controller);

  // Global keyboard shortcuts (e.g. Esc to interrupt)
  useInput((_, key) => {
    if (key.escape && status !== 'idle' && !pendingApproval) {
      interrupt();
    }
  });

  const handleCommandOrPrompt = async (text: string) => {
    if (text.startsWith('/rollback')) {
      const parts = text.split(' ');
      const targetIndex = parts[1] ? parseInt(parts[1], 10) : session.messages.length - 2;
      if (!isNaN(targetIndex) && targetIndex >= 0) {
        rollback(targetIndex);
      }
      return;
    }

    if (text.startsWith('/fork')) {
      controller.forkSession(session.messages.length);
      return;
    }

    if (text.startsWith('/sessions')) {
      const store = new DshSharedSessionStore();
      const list = store.listSessions();
      const summaryText = list.length === 0 
        ? 'No past sessions found in ~/.dsh/sessions' 
        : `Recent sessions in ~/.dsh/sessions:\n` + list.slice(0, 5).map(s => `  • ${s.id} - ${s.title} (${s.messageCount} msgs, ${s.model})`).join('\n') + `\n\nUse /resume <id> to resume.`;
      
      session.messages.push({
        id: `sys_${Date.now()}`,
        role: 'system',
        content: summaryText,
        timestamp: Date.now(),
        status: 'complete',
      });
      controller.events.emitEvent({ type: 'session:updated', session });
      return;
    }

    if (text.startsWith('/resume')) {
      const parts = text.split(' ');
      const targetId = parts[1]?.trim();
      if (!targetId) {
        session.messages.push({
          id: `sys_${Date.now()}`,
          role: 'system',
          content: 'Usage: /resume <session_id>',
          timestamp: Date.now(),
          status: 'complete',
        });
        controller.events.emitEvent({ type: 'session:updated', session });
        return;
      }

      const store = new DshSharedSessionStore();
      const loaded = store.readSession(targetId);
      if (loaded) {
        controller.loadSession(loaded);
      } else {
        session.messages.push({
          id: `sys_${Date.now()}`,
          role: 'system',
          content: `Session "${targetId}" not found in ~/.dsh/sessions`,
          timestamp: Date.now(),
          status: 'complete',
        });
        controller.events.emitEvent({ type: 'session:updated', session });
      }
      return;
    }

    if (text.startsWith('/save')) {
      const store = new DshSharedSessionStore();
      store.saveSession(session);
      session.messages.push({
        id: `sys_${Date.now()}`,
        role: 'system',
        content: `Session successfully saved to ~/.dsh/sessions/${session.id}.json`,
        timestamp: Date.now(),
        status: 'complete',
      });
      controller.events.emitEvent({ type: 'session:updated', session });
      return;
    }

    await submitPrompt(text);
  };

  const isWorking = status !== 'idle' && status !== 'error';

  return (
    <Box flexDirection="column" padding={1} width="100%">
      <Header
        model={session.model}
        status={status}
        metrics={metrics}
        workspacePath={session.workspacePath}
      />

      <MessageList
        messages={session.messages}
        currentContent={currentContent}
      />

      <ReasoningBox
        reasoning={currentReasoning}
        isStreaming={status === 'thinking' || status === 'generating'}
      />

      {pendingApproval && (
        <ApprovalPrompt
          approval={pendingApproval}
          onDecision={respondApproval}
        />
      )}

      <InputBar
        onSubmit={handleCommandOrPrompt}
        onInterrupt={interrupt}
        disabled={isWorking && !pendingApproval}
      />
    </Box>
  );
};
