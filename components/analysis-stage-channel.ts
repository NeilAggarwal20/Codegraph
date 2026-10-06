'use client';

import { useEffect, useState } from 'react';
import type { AnalysisStatus } from '@/lib/types';
import { useAnalysisRealtimeClient } from '@/components/analysis-realtime-provider';

export interface AnalysisStageView {
  status: AnalysisStatus;
  stage: string;
  message: string;
  updatedAt: number;
  connectionError: string | null;
  connected: boolean;
}

export function useAnalysisStageChannel(
  analysisId: string,
  initial: Omit<AnalysisStageView, 'connectionError' | 'connected'>,
  enabled: boolean,
) {
  const supabase = useAnalysisRealtimeClient();
  const [latestStage, setLatestStage] = useState<Omit<AnalysisStageView, 'connectionError' | 'connected'> | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const view = {
    ...(latestStage && latestStage.updatedAt >= initial.updatedAt ? latestStage : initial),
    connected,
    connectionError,
  };

  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel(`analysis:${analysisId}`, { config: { private: true } })
      .on('broadcast', { event: 'stage' }, (broadcast) => {
        const payload = broadcast.payload as { stage?: unknown; message?: unknown };
        const stage = payload.stage;
        const message = payload.message;
        if (typeof stage !== 'string' || typeof message !== 'string') return;
        setLatestStage({
          status: payload.stage === 'completed'
            ? 'completed'
            : payload.stage === 'failed'
              ? 'failed'
              : payload.stage === 'pending'
                ? 'pending'
                : 'parsing',
          stage,
          message,
          updatedAt: Date.now(),
        });
      })
      .subscribe((status, error) => {
        if (status === 'SUBSCRIBED') {
          setConnected(true);
          setConnectionError(null);
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConnected(false);
          setConnectionError(error?.message ?? 'Could not connect to the live progress channel.');
        }
        if (status === 'CLOSED') setConnected(false);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [analysisId, enabled, supabase]);

  return view;
}
