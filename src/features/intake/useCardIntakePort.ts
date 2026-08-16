import { useEffect, useRef } from 'react';
import type { CardIntakeControllerPort } from './cardIntakeController';
import {
  createCardIntakePipeline,
  type CardIntakePipeline,
} from './cardIntakePipeline';
import type { CardIntakePortOptions } from './cardIntakePortContract';

export function useCardIntakePort(options: CardIntakePortOptions): CardIntakeControllerPort {
  const latestRef = useRef(options);
  latestRef.current = options;
  const pipelineRef = useRef<CardIntakePipeline | null>(null);
  if (!pipelineRef.current) {
    pipelineRef.current = createCardIntakePipeline({
      getContext: () => latestRef.current,
    });
  }
  pipelineRef.current.replaceOwner(options.ownerId);
  options.connectPendingCreateSettlement(pipelineRef.current.settlePendingCreate);
  useEffect(() => () => pipelineRef.current?.dispose(), []);
  return pipelineRef.current;
}
