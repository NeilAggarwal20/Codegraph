import { CanvasShell } from '@/components/canvas-shell';
import previewAnalysisData from '@/data/preview-analysis.json';
import { readParserResult } from '@/lib/parser/read-result';

export default function CanvasPreviewPage() {
  const analysis = readParserResult(previewAnalysisData);
  return (
    <div className="h-[calc(100vh-4rem)] min-h-0">
      <CanvasShell analysis={analysis} />
    </div>
  );
}
