import { useState, useEffect, useRef, useCallback } from 'react';
import type { Agent, Task } from '../types';
import * as api from '../api';

interface TerminalPanelProps {
  taskId: string;
  task: Task | undefined;
  agent: Agent | undefined;
  onClose: () => void;
}

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  in_progress: { label: 'Running', color: 'bg-amber-500/20 text-amber-400 border-amber-500/40' },
  review: { label: 'Review', color: 'bg-purple-500/20 text-purple-400 border-purple-500/40' },
  done: { label: 'Done', color: 'bg-green-500/20 text-green-400 border-green-500/40' },
  inbox: { label: 'Inbox', color: 'bg-slate-500/20 text-slate-400 border-slate-500/40' },
  planned: { label: 'Planned', color: 'bg-blue-500/20 text-blue-400 border-blue-500/40' },
  cancelled: { label: 'Cancelled', color: 'bg-red-500/20 text-red-400 border-red-500/40' },
};

interface TaskLogEntry {
  id: number;
  kind: string;
  message: string;
  created_at: number;
}

export default function TerminalPanel({ taskId, task, agent, onClose }: TerminalPanelProps) {
  const [text, setText] = useState('');
  const [taskLogs, setTaskLogs] = useState<TaskLogEntry[]>([]);
  const [logPath, setLogPath] = useState('');
  const [follow, setFollow] = useState(true);
  const preRef = useRef<HTMLPreElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Poll terminal endpoint every 1.5s
  const fetchTerminal = useCallback(async () => {
    try {
      const res = await api.getTerminal(taskId, 800, true);
      if (res.ok) {
        setLogPath(res.path);
        if (res.task_logs) setTaskLogs(res.task_logs);
        if (res.exists && res.text) {
          setText(res.text);
        }
      }
    } catch {
      // ignore
    }
  }, [taskId]);

  useEffect(() => {
    fetchTerminal();
    const timer = setInterval(fetchTerminal, 1500);
    return () => clearInterval(timer);
  }, [fetchTerminal]);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Auto-scroll when follow is enabled
  useEffect(() => {
    if (follow && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [text, follow]);

  // Detect if user scrolled away from bottom
  function handleScroll() {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    if (!atBottom && follow) setFollow(false);
  }

  function scrollToBottom() {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setFollow(true);
    }
  }

  const badge = STATUS_BADGES[task?.status ?? ''] ?? STATUS_BADGES.inbox;

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-[560px] max-w-full flex flex-col bg-[#0d1117] border-l border-slate-700/50 shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/50 bg-[#161b22]">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {agent && (
            <span className="text-xl flex-shrink-0">{agent.avatar_emoji}</span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white truncate">
                {task?.title ?? taskId}
              </h3>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.color} flex-shrink-0`}>
                {badge.label}
              </span>
            </div>
            {logPath && (
              <div className="text-[10px] text-slate-500 truncate font-mono mt-0.5">
                {logPath}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Follow toggle */}
          <button
            onClick={() => setFollow(f => !f)}
            className={`px-2 py-1 text-[10px] rounded border transition ${
              follow
                ? 'bg-green-500/20 text-green-400 border-green-500/40'
                : 'bg-slate-700/50 text-slate-400 border-slate-600'
            }`}
            title={follow ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
          >
            {follow ? 'FOLLOW' : 'PAUSED'}
          </button>
          {/* Scroll to bottom */}
          <button
            onClick={scrollToBottom}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition"
            title="Scroll to bottom"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </button>
          {/* Close */}
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Task log markers (system events) */}
      {taskLogs.length > 0 && (
        <div className="px-4 py-2 border-b border-slate-700/30 bg-[#161b22]/50 space-y-0.5 max-h-24 overflow-y-auto">
          {taskLogs.map(log => {
            const kindColor = log.kind === 'error' ? 'text-red-400' :
              log.kind === 'system' ? 'text-cyan-400' : 'text-slate-500';
            const time = new Date(log.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return (
              <div key={log.id} className={`text-[10px] font-mono ${kindColor}`}>
                [{time}] {log.message}
              </div>
            );
          })}
        </div>
      )}

      {/* Terminal body */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-4"
        onScroll={handleScroll}
      >
        {!text ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <div className="text-3xl mb-3">
              {task?.status === 'in_progress' ? (
                <span className="inline-block animate-spin">&#9881;</span>
              ) : (
                <span>&#128421;</span>
              )}
            </div>
            <div className="text-sm">
              {task?.status === 'in_progress'
                ? 'Waiting for output...'
                : 'No terminal output yet'}
            </div>
          </div>
        ) : (
          <pre
            ref={preRef}
            className="text-[12px] leading-relaxed text-green-300 font-mono whitespace-pre-wrap break-words selection:bg-green-800/40"
          >
            {text}
          </pre>
        )}
      </div>

      {/* Bottom status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-slate-700/50 bg-[#161b22] text-[10px] text-slate-500">
        <span>
          {agent ? `${agent.avatar_emoji} ${agent.name_ko || agent.name}` : 'No agent'}
          {agent?.cli_provider ? ` (${agent.cli_provider})` : ''}
        </span>
        <span>
          {task?.status === 'in_progress' && (
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Live
            </span>
          )}
          {task?.status === 'review' && 'Under review'}
          {task?.status === 'done' && 'Completed'}
        </span>
      </div>
    </div>
  );
}
