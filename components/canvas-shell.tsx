'use client';

import dagre from '@dagrejs/dagre';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  useViewport,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ExplanationText } from './explanation-text';
import { ReanalyseButton } from './analysis-map-actions';
import { foldRepository, type FoldedGraph } from '@/lib/graph/folded-graph';
import { walkGraph } from '@/lib/graph/analysis';
import { countFrameworkRoles, frameworkNames } from '@/lib/framework/taxonomy';
import type { WalkDirection } from '@/lib/graph/analysis';
import type { DependencyEdge, ParsedFile, ParserResult } from '@/lib/parser/types';

const maxPanelFileHeight = 320;
const fileRowHeight = 25;
const folderNodeType = 'folder';
const incomingColor = 'var(--incoming)';
const outgoingColor = 'var(--outgoing)';
const quietEdgeColor = 'var(--line-strong)';

interface FolderNodeData extends Record<string, unknown> {
  label: string;
  files: ParsedFile[];
  fanIn: number;
  fanOut: number;
  expanded: boolean;
  focused: boolean;
  dimmed: boolean;
  focusActive: boolean;
  highlightedFilePaths: string[];
  selectedFilePath: string | null;
  selectedCategory: string | null;
}

interface FlowEdgeData extends Record<string, unknown> {
  groupedEdgeId: string;
  member: DependencyEdge | null;
  dimmed: boolean;
}

type FolderFlowNode = Node<FolderNodeData, typeof folderNodeType>;
type DependencyFlowEdge = Edge<FlowEdgeData, 'default'>;

interface GraphFocus {
  nodeId: string;
  filePath?: string;
}

interface DagrePoint {
  x: number;
  y: number;
}

interface FolderInteractions {
  onToggle: (folder: string) => void;
  onSelectFile: (filePath: string) => void;
}

const FolderInteractionsContext = createContext<FolderInteractions | null>(null);

function foldedNodeHeight(fanIn: number): number {
  return 50 + Math.min(148, Math.round(Math.log2(fanIn + 1) * 16));
}

function folderNodeWidth(label: string, expanded: boolean): number {
  if (expanded) return 310;
  return Math.max(112, Math.min(280, 38 + label.length * 8));
}

function expandedNodeHeight(fileCount: number): number {
  return 43 + Math.min(maxPanelFileHeight, fileCount * fileRowHeight) + 8;
}

function fileHandleId(direction: 'source' | 'target', filePath: string): string {
  return `${direction}:${filePath}`;
}

function sizeForNode(node: FoldedGraph['nodes'][number], expanded: boolean): { width: number; height: number } {
  return {
    width: folderNodeWidth(node.label, expanded),
    height: expanded ? expandedNodeHeight(node.files.length) : foldedNodeHeight(node.fanIn),
  };
}

function getPositions(graph: FoldedGraph, expandedFolders: Set<string>): Map<string, DagrePoint> {
  const layout = new dagre.graphlib.Graph();
  layout.setGraph({
    rankdir: 'LR',
    nodesep: 48,
    edgesep: 18,
    ranksep: 88,
    marginx: 36,
    marginy: 28,
  });
  layout.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    const size = sizeForNode(node, expandedFolders.has(node.id));
    layout.setNode(node.id, size);
  }
  for (const edge of graph.edges) {
    layout.setEdge(edge.from, edge.to, { weight: edge.edges.length });
  }
  dagre.layout(layout);

  const positions = new Map<string, DagrePoint>();
  for (const node of graph.nodes) {
    const size = sizeForNode(node, expandedFolders.has(node.id));
    const point = layout.node(node.id) as DagrePoint | undefined;
    if (point) positions.set(node.id, { x: point.x - size.width / 2, y: point.y - size.height / 2 });
  }
  return positions;
}

function getRelatedNodeIds(graph: FoldedGraph, focus: GraphFocus | null, edges: DependencyEdge[]): Set<string> {
  if (!focus) return new Set(graph.nodes.map((node) => node.id));

  const related = new Set([focus.nodeId]);
  if (focus.filePath) {
    for (const edge of edges) {
      if (edge.from === focus.filePath) {
        const target = graph.fileOwners.get(edge.to);
        if (target) related.add(target);
      }
      if (edge.to === focus.filePath) {
        const source = graph.fileOwners.get(edge.from);
        if (source) related.add(source);
      }
    }
  } else {
    for (const edge of graph.edges) {
      if (edge.from === focus.nodeId) related.add(edge.to);
      if (edge.to === focus.nodeId) related.add(edge.from);
    }
  }
  return related;
}

function getHighlightedFilePaths(graph: FoldedGraph, focus: GraphFocus | null, edges: DependencyEdge[]): Set<string> {
  const highlighted = new Set<string>();
  if (!focus) return highlighted;

  if (focus.filePath) highlighted.add(focus.filePath);
  else {
    const focusedNode = graph.nodes.find((node) => node.id === focus.nodeId);
    for (const file of focusedNode?.files ?? []) highlighted.add(file.path);
  }

  for (const edge of edges) {
    const fromOwner = graph.fileOwners.get(edge.from);
    const toOwner = graph.fileOwners.get(edge.to);
    const touchesFocus = focus.filePath
      ? edge.from === focus.filePath || edge.to === focus.filePath
      : fromOwner === focus.nodeId || toOwner === focus.nodeId;
    if (!touchesFocus) continue;
    highlighted.add(edge.from);
    highlighted.add(edge.to);
  }
  return highlighted;
}

function getFlowNodes(
  graph: FoldedGraph,
  expandedFolders: Set<string>,
  focus: GraphFocus | null,
  relatedIds: Set<string>,
  highlightedFiles: Set<string>,
  selectedCategory: string | null,
): FolderFlowNode[] {
  const positions = getPositions(graph, expandedFolders);
  return graph.nodes.map((node) => {
    const expanded = expandedFolders.has(node.id);
    const matchingFiles = selectedCategory ? node.files.filter((file) => file.kind === selectedCategory) : node.files;
    return {
      id: node.id,
      type: folderNodeType,
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      width: folderNodeWidth(node.label, expanded),
      height: expanded ? expandedNodeHeight(node.files.length) : foldedNodeHeight(node.fanIn),
      data: {
        label: node.label,
        files: node.files,
        fanIn: node.fanIn,
        fanOut: node.fanOut,
        expanded,
        focused: focus?.nodeId === node.id,
        dimmed: !relatedIds.has(node.id) || (selectedCategory !== null && matchingFiles.length === 0),
        focusActive: focus !== null,
        highlightedFilePaths: [...highlightedFiles],
        selectedFilePath: focus?.filePath ?? null,
        selectedCategory,
      },
    };
  });
}

function handleForFile(direction: 'source' | 'target', filePath: string): string {
  return fileHandleId(direction, filePath);
}

function getFlowEdges(
  graph: FoldedGraph,
  expandedFolders: Set<string>,
  focus: GraphFocus | null,
  selectedCategory: string | null,
): DependencyFlowEdge[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const output: DependencyFlowEdge[] = [];

  for (const group of graph.edges) {
    const sourceNode = nodeById.get(group.from);
    const targetNode = nodeById.get(group.to);
    if (!sourceNode || !targetNode) continue;
    const sourceExpanded = expandedFolders.has(group.from);
    const targetExpanded = expandedFolders.has(group.to);
    const splitMembers = sourceExpanded || targetExpanded || focus?.filePath !== undefined || selectedCategory !== null;
    const members: Array<DependencyEdge | null> = splitMembers ? group.edges : [null];

    for (let index = 0; index < members.length; index += 1) {
      const member = members[index];
      const inFocusedGroup = focus?.nodeId === group.from || focus?.nodeId === group.to;
      const touchesFocusedFile = focus?.filePath !== undefined && member !== null &&
        (member.from === focus.filePath || member.to === focus.filePath);
      const categoryMatches = selectedCategory === null || (member !== null &&
        (sourceNode.files.some((file) => file.path === member.from && file.kind === selectedCategory) || targetNode.files.some((file) => file.path === member.to && file.kind === selectedCategory)));
      const dimmed = (focus !== null && (focus.filePath ? !touchesFocusedFile : !inFocusedGroup)) || !categoryMatches;
      const isFocusedOutgoing = focus?.filePath
        ? member?.from === focus.filePath
        : focus?.nodeId === group.from;
      const isFocusedIncoming = focus?.filePath
        ? member?.to === focus.filePath
        : focus?.nodeId === group.to;
      const stroke = isFocusedOutgoing ? outgoingColor : isFocusedIncoming ? incomingColor : quietEdgeColor;

      const id = member ? `${group.id}:${member.from}:${member.to}:${member.kind}` : group.id;
      output.push({
        id,
        source: group.from,
        target: group.to,
        sourceHandle: sourceExpanded && member ? handleForFile('source', member.from) : undefined,
        targetHandle: targetExpanded && member ? handleForFile('target', member.to) : undefined,
        type: 'default',
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        label: member ? undefined : group.edges.length > 1 ? String(group.edges.length) : undefined,
        labelStyle: { fill: 'var(--fg-muted)', fontSize: 10, fontFamily: 'var(--font-geist-mono)' },
        labelBgStyle: { fill: 'var(--canvas)' },
        style: {
          stroke,
          strokeWidth: dimmed ? 1 : Math.max(2, Math.min(3.5, 1 + Math.log2(group.edges.length))),
          opacity: dimmed ? 0.1 : 1,
        },
        data: {
          groupedEdgeId: group.id,
          member,
          dimmed,
        },
        selectable: false,
      });
    }
  }

  for (const member of graph.internalEdges) {
    const folder = graph.fileOwners.get(member.from);
    if (!folder || !expandedFolders.has(folder)) continue;
    const selectedFile = focus?.filePath;
    const touchesFocusedFile = selectedFile !== undefined && (member.from === selectedFile || member.to === selectedFile);
    const categoryMatches = selectedCategory === null ||
      graph.fileOwners.get(member.from) === folder && graph.nodes.find((node) => node.id === folder)?.files.some((file) => file.path === member.from && file.kind === selectedCategory) ||
      graph.fileOwners.get(member.to) === folder && graph.nodes.find((node) => node.id === folder)?.files.some((file) => file.path === member.to && file.kind === selectedCategory);
    const dimmed = (focus !== null && (selectedFile ? !touchesFocusedFile : focus.nodeId !== folder)) || !categoryMatches;
    const isFocusedOutgoing = selectedFile ? member.from === selectedFile : focus?.nodeId === folder;
    const isFocusedIncoming = selectedFile ? member.to === selectedFile : focus?.nodeId === folder;
    const stroke = isFocusedOutgoing ? outgoingColor : isFocusedIncoming ? incomingColor : quietEdgeColor;
    output.push({
      id: `internal:${member.from}:${member.to}:${member.kind}`,
      source: folder,
      target: folder,
      sourceHandle: handleForFile('source', member.from),
      targetHandle: handleForFile('target', member.to),
      type: 'default',
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
      style: { stroke, strokeWidth: dimmed ? 1 : 2, opacity: dimmed ? 0.1 : 1 },
      data: { groupedEdgeId: `internal:${folder}`, member, dimmed },
      selectable: false,
    });
  }
  return output;
}

function FileHandles({ file }: { file: ParsedFile }) {
  return (
    <>
      <Handle
        id={fileHandleId('target', file.path)}
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={{ top: '50%' }}
        className="!h-1.5 !w-1.5 !border !border-line !bg-accent"
      />
      <Handle
        id={fileHandleId('source', file.path)}
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={{ top: '50%' }}
        className="!h-1.5 !w-1.5 !border !border-line !bg-accent"
      />
    </>
  );
}

function FolderNodeView({ id, data }: NodeProps<FolderFlowNode>) {
  const interactions = useContext(FolderInteractionsContext);
  const updateNodeInternals = useUpdateNodeInternals();
  if (!interactions) throw new Error('Folder node is missing its interaction context.');
  const wrapperClass = data.expanded
    ? 'h-full w-full overflow-hidden rounded border border-line bg-surface shadow-sm'
    : 'flex h-full w-full flex-col justify-center overflow-hidden rounded border border-line bg-surface px-3 py-2 shadow-sm';

  if (!data.expanded) {
    return (
      <div
        className={`${wrapperClass} cursor-pointer ${data.focused ? 'border-accent ring-1 ring-accent/40' : ''} ${data.dimmed ? 'opacity-20' : 'opacity-100'}`}
        role="button"
        tabIndex={0}
        aria-label={`Open ${data.label} module, ${data.files.length} files`}
        aria-expanded={false}
        onClick={(event) => {
          event.stopPropagation();
          interactions.onToggle(id);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            interactions.onToggle(id);
          }
        }}
      >
        <Handle type="target" position={Position.Left} isConnectable={false} className="!h-1.5 !w-1.5 !border !border-line !bg-fg-muted" />
        <Handle type="source" position={Position.Right} isConnectable={false} className="!h-1.5 !w-1.5 !border !border-line !bg-fg-muted" />
        <span className="truncate font-mono text-xs font-semibold text-fg" title={data.label}>{data.label}</span>
        <span className="mt-1 flex items-center justify-between gap-2 font-mono text-[10px] text-fg-muted">
          <span>{data.files.length} files</span>
          <span>↓ {data.fanIn}</span>
        </span>
      </div>
    );
  }

  return (
    <div className={`${wrapperClass} ${data.focused ? 'border-accent ring-1 ring-accent/40' : ''} ${data.dimmed ? 'opacity-20' : 'opacity-100'}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} className="!h-1.5 !w-1.5 !border !border-line !bg-fg-muted" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="!h-1.5 !w-1.5 !border !border-line !bg-fg-muted" />
      <button
        type="button"
        className="nodrag flex h-[42px] w-full items-center justify-between gap-2 border-b border-line bg-raised px-2.5 text-left"
        onClick={(event) => {
          event.stopPropagation();
          interactions.onToggle(id);
        }}
        title="Close folder panel"
      >
        <span className="min-w-0 truncate font-mono text-[11px] font-semibold text-fg">{data.label}</span>
        <span className="shrink-0 font-mono text-[9px] text-fg-muted">{data.files.length} · ↓{data.fanIn} ↑{data.fanOut}</span>
      </button>
      <div
        className="nopan nodrag max-h-[320px] overflow-y-auto overscroll-contain"
        onScroll={() => updateNodeInternals(id)}
        onWheel={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex h-6 items-center justify-between border-b border-line bg-surface px-2.5 font-mono text-[9px] text-fg-muted">
          <span>{data.files.length} files</span>
          {data.selectedCategory && <span>{data.files.filter((file) => file.kind === data.selectedCategory).length} match{data.files.filter((file) => file.kind === data.selectedCategory).length === 1 ? '' : 'es'}</span>}
        </div>
        {data.files.map((file) => {
          const rowDimmed = data.dimmed || (data.focusActive && !data.highlightedFilePaths.includes(file.path)) || (data.selectedCategory !== null && file.kind !== data.selectedCategory);
          const selected = data.selectedFilePath === file.path;
          return (
            <div key={file.path} className="relative h-[25px] border-b border-line/70">
              <FileHandles file={file} />
            <button
              type="button"
              className={`nodrag flex h-full w-full cursor-pointer items-center px-2.5 text-left font-mono text-[11px] ${rowDimmed ? 'opacity-20' : 'opacity-100'} ${selected ? 'bg-accent/10 text-accent' : 'text-fg'}`}
              onClick={(event) => {
                event.stopPropagation();
                interactions.onSelectFile(file.path);
              }}
              title={file.path}
            >
              <span className="truncate">{file.path}</span>
            </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const nodeTypes = { [folderNodeType]: FolderNodeView };

function getKindColor(kind: string): string {
  if (kind === 'module') return 'var(--accent)';
  const palette = ['var(--accent)', 'var(--incoming)', 'var(--outgoing)', 'var(--fg-muted)'];
  let hash = 0;
  for (const character of kind) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

function getKindCounts(files: ParsedFile[]): Array<{ kind: string; count: number }> {
  const counts = new Map<string, number>();
  for (const file of files) counts.set(file.kind, (counts.get(file.kind) ?? 0) + 1);
  return [...counts.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

function getRepositoryName(root: string): string {
  const segments = root.split(/[\\/]+/).filter(Boolean);
  const sourceFolders = new Set(['src', 'app', 'lib', 'frontend', 'backend']);
  if (segments.length > 1 && sourceFolders.has(segments.at(-1)?.toLowerCase() ?? '')) segments.pop();
  const directoryName = segments.at(-1) ?? root;
  return directoryName.replace(/^codegraph-/i, '') || directoryName;
}

function PathButton({
  path,
  onSelect,
}: {
  path: string;
  onSelect: (path: string) => void;
}) {
  return (
    <button
      type="button"
      className="block w-full truncate px-2 py-1 text-left font-mono text-[11px] text-fg"
      title={path}
      onClick={() => onSelect(path)}
    >
      {path}
    </button>
  );
}

function DetailPane({
  analysis,
  graph,
  analysisId,
  repositoryUrl,
  tracingConfigured,
  onRoleAssigned,
  focus,
  selectedTab,
  onTabChange,
  onSelectPath,
  onClear,
}: {
  analysis: ParserResult;
  graph: FoldedGraph;
  analysisId?: string;
  repositoryUrl?: string;
  tracingConfigured?: boolean;
  onRoleAssigned: (path: string, role: string) => void;
  focus: GraphFocus | null;
  selectedTab: 'structure' | 'explanation';
  onTabChange: (tab: 'structure' | 'explanation') => void;
  onSelectPath: (path: string) => void;
  onClear: () => void;
}) {
  const selectedFile = focus?.filePath
    ? analysis.files.find((file) => file.path === focus.filePath) ?? null
    : null;
  const selectedFolder = focus && !focus.filePath
    ? graph.nodes.find((node) => node.id === focus.nodeId) ?? null
    : null;
  const onSelectFile = onSelectPath;
  const importPaths = selectedFile
    ? [...new Set(analysis.edges.filter((edge) => edge.from === selectedFile.path).map((edge) => edge.to))].sort()
    : [];
  const dependentPaths = selectedFile
    ? [...new Set(analysis.edges.filter((edge) => edge.to === selectedFile.path).map((edge) => edge.from))].sort()
    : [];
  const mostDependedOn = [...analysis.files]
    .filter((file) => file.fanIn > 0)
    .sort((a, b) => b.fanIn - a.fanIn || a.path.localeCompare(b.path));
  const filesNothingImports = [...analysis.files]
    .filter((file) => file.fanIn === 0)
    .sort((a, b) => b.fanOut - a.fanOut || a.path.localeCompare(b.path));
  const routeCount = analysis.routes.length;
  const routeDisplay = routeCount === 0 ? '—' : routeCount;
  const folderKinds = selectedFolder ? getKindCounts(selectedFolder.files) : [];
  const [walkDirection, setWalkDirection] = useState<WalkDirection | null>(null);
  const walkEntries = selectedFile && walkDirection
    ? walkGraph(analysis.files, analysis.edges, selectedFile.path, walkDirection, 2)
    : [];
  const walkTitle = walkDirection === 'dependents' ? 'Blast radius' : 'Dependency chain';
  const selectedSubject = selectedFile
    ? { subjectType: 'file' as const, subjectPath: selectedFile.path, filePaths: [selectedFile.path] }
    : selectedFolder
      ? { subjectType: 'folder' as const, subjectPath: selectedFolder.id, filePaths: selectedFolder.files.map((file) => file.path) }
      : null;
  const explanationKey = selectedSubject ? `${selectedSubject.subjectType}:${selectedSubject.subjectPath}` : null;
  const [explanations, setExplanations] = useState<Record<string, { status: 'ready' | 'stale'; explanation?: string; role?: string | null; message?: string }>>({});
  const [explanationErrors, setExplanationErrors] = useState<Record<string, string>>({});
  const [pendingExplanation, setPendingExplanation] = useState<string | null>(null);
  const currentExplanation = explanationKey ? explanations[explanationKey] : undefined;
  const currentExplanationError = explanationKey ? explanationErrors[explanationKey] : undefined;

  const requestExplanation = async () => {
    const subject = selectedSubject;
    const key = explanationKey;
    if (!subject || !key) return;
    onTabChange('explanation');
    if (explanations[key]?.status || pendingExplanation === key) return;
    if (!analysisId || !repositoryUrl) {
      setExplanationErrors((current) => ({ ...current, [key]: 'Explanations are unavailable in the preview.' }));
      return;
    }
    setExplanationErrors((current) => ({ ...current, [key]: '' }));
    setPendingExplanation(key);
    try {
      const response = await fetch(`/api/analysis/${encodeURIComponent(analysisId)}/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subject),
      });
      const result = await response.json() as {
        status?: 'ready' | 'stale';
        explanation?: string;
        role?: string | null;
        message?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? 'Could not explain this item.');
      if (result.status === 'stale') {
        setExplanations((current) => ({ ...current, [key]: { status: 'stale', message: result.message ?? 'This explanation is stale.' } }));
      } else if (result.status === 'ready' && result.explanation) {
        setExplanations((current) => ({ ...current, [key]: { status: 'ready', explanation: result.explanation, role: result.role } }));
        if (selectedFile && result.role) onRoleAssigned(selectedFile.path, result.role);
      } else {
        throw new Error('The explanation service returned an invalid response.');
      }
    } catch (error) {
      setExplanationErrors((current) => ({ ...current, [key]: error instanceof Error ? error.message : 'Could not explain this item.' }));
    } finally {
      setPendingExplanation(null);
    }
  };

  return (
    <aside aria-label="Details" className="flex min-h-0 flex-col border-l border-line bg-surface">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-fg">
        <span>Details</span>
        {focus && <button type="button" onClick={onClear} className="text-[9px]">Clear</button>}
      </div>
      <div className="flex h-8 shrink-0 border-b border-line px-2">
        {(['structure', 'explanation'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={`border-b px-2 font-mono text-[11px] capitalize ${selectedTab === tab ? 'border-accent text-accent' : 'border-transparent text-fg'}`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {selectedTab === 'explanation' ? (
          <div className="space-y-3 px-2 py-2 font-mono text-[10px] leading-5">
            {tracingConfigured ? (
              <p className="text-fg-muted">LangSmith tracing is on.</p>
            ) : (
              <p className="text-fg-muted">LangSmith tracing is off. Set LANGSMITH_TRACING=true and LANGSMITH_API_KEY to record runs.</p>
            )}
            {!selectedSubject ? (
              <p className="text-fg-muted">Select a file or folded folder, then click Explain.</p>
            ) : currentExplanation?.status === 'ready' ? (
              <ExplanationText content={currentExplanation.explanation ?? ''} filePaths={[...analysis.files.map((file) => file.path), ...graph.nodes.map((node) => node.id)]} onSelectPath={onSelectPath} />
            ) : currentExplanation?.status === 'stale' ? (
              <div className="space-y-3"><p className="text-amber-700 dark:text-amber-400">{currentExplanation.message}</p>{repositoryUrl && <ReanalyseButton repositoryUrl={repositoryUrl} />}</div>
            ) : pendingExplanation === explanationKey ? (
              <p className="text-fg-muted">Explaining {selectedSubject.subjectType}…</p>
            ) : currentExplanationError ? (
              <div className="space-y-2"><p role="alert" className="text-rose-700 dark:text-rose-400">{currentExplanationError}</p><button type="button" onClick={requestExplanation} className="cursor-pointer text-accent underline underline-offset-2">Try again</button></div>
            ) : (
              <div className="space-y-2"><p className="text-fg-muted">No explanation has been requested for this item yet.</p><button type="button" onClick={requestExplanation} className="cursor-pointer rounded border border-line px-2 py-1 text-fg">Explain</button></div>
            )}
          </div>
        ) : selectedFile ? (
          <div className="space-y-3">
            <header className="space-y-1 px-2">
              <h2 className="break-all font-mono text-[11px] font-semibold text-fg">{selectedFile.path}</h2>
              <p className="font-mono text-[10px] text-fg-muted">{selectedFile.path.split('/').slice(0, -1).join('/') || '.'}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-2 font-mono text-[10px]">
                <dt className="text-fg-muted">Kind</dt><dd className="text-fg">{selectedFile.path.match(/\.[^.]+$/)?.[0] ?? 'source'}</dd>
                <dt className="text-fg-muted">Role</dt><dd className="text-fg">{selectedFile.kind}</dd>
                <dt className="text-fg-muted">Length</dt><dd className="text-fg">{selectedFile.lines} lines</dd>
                <dt className="text-fg-muted">Depends on</dt><dd className="text-fg">{importPaths.length} files</dd>
                <dt className="text-fg-muted">Depended on by</dt><dd className="text-fg">{dependentPaths.length} files</dd>
                <dt className="text-fg-muted">Reached by</dt><dd className="text-fg">imports only</dd>
                {selectedFile.exports.length > 0 && <><dt className="text-fg-muted">Exports</dt><dd className="truncate text-fg">{selectedFile.exports.join(', ')}</dd></>}
              </dl>
            </header>
            <button type="button" onClick={requestExplanation} className="mx-2 cursor-pointer rounded border border-line px-2 py-1 font-mono text-[10px] text-fg">Explain</button>
            <RelationshipList title="Imports" paths={importPaths} count={importPaths.length} onSelect={onSelectFile} />
            <RelationshipList title="Imported by" paths={dependentPaths} count={dependentPaths.length} onSelect={onSelectFile} />
            {selectedFile.exports.length > 0 && <section>
              <SectionTitle>CommonJS exports · {selectedFile.exports.length}</SectionTitle>
              {selectedFile.exports.map((name) => <p key={name} className="break-all px-2 py-1 font-mono text-[10px] text-fg">{name}</p>)}
            </section>}
            <section>
              <SectionTitle>Impact · two levels</SectionTitle>
              <div className="flex gap-1 p-2">
                <button type="button" onClick={() => setWalkDirection(walkDirection === 'dependents' ? null : 'dependents')} className={`cursor-pointer rounded border px-2 py-1 font-mono text-[10px] ${walkDirection === 'dependents' ? 'border-accent text-accent' : 'border-line text-fg'}`}>Blast radius</button>
                <button type="button" onClick={() => setWalkDirection(walkDirection === 'dependencies' ? null : 'dependencies')} className={`cursor-pointer rounded border px-2 py-1 font-mono text-[10px] ${walkDirection === 'dependencies' ? 'border-accent text-accent' : 'border-line text-fg'}`}>Dependency chain</button>
              </div>
              {walkDirection && <>
                <SectionTitle>{walkTitle} · {walkEntries.length}</SectionTitle>
                {[1, 2].map((depth) => {
                  const filesAtDepth = walkEntries.filter((entry) => entry.depth === depth);
                  return <section key={depth}>
                    <SectionTitle>{depth} step{depth === 1 ? '' : 's'} away · {filesAtDepth.length}</SectionTitle>
                    {filesAtDepth.map(({ path }) => <PathButton key={path} path={path} onSelect={onSelectFile} />)}
                  </section>;
                })}
                {walkEntries.length === 0 && <p className="px-2 py-1 font-mono text-[10px] text-fg-muted">No connected files within two levels.</p>}
              </>}
            </section>
          </div>
        ) : selectedFolder ? (
          <div className="space-y-3">
            <header className="space-y-1 px-2">
              <h2 className="break-all font-mono text-[11px] font-semibold text-fg">{selectedFolder.label}</h2>
              <p className="font-mono text-[11px] text-fg">{selectedFolder.files.length} files · ↓ {selectedFolder.fanIn} · ↑ {selectedFolder.fanOut}</p>
            </header>
            <button type="button" onClick={requestExplanation} className="mx-2 cursor-pointer rounded border border-line px-2 py-1 font-mono text-[10px] text-fg">Explain</button>
            <section>
              <SectionTitle>File kinds</SectionTitle>
              {folderKinds.map(({ kind, count }) => (
                <div key={kind} className="flex justify-between px-2 py-1 font-mono text-[11px] text-fg">
                  <span>{kind}</span><span>{count}</span>
                </div>
              ))}
            </section>
            <section>
              <SectionTitle>Files · {selectedFolder.files.length}</SectionTitle>
              {selectedFolder.files.map((file) => (
                <PathButton key={file.path} path={file.path} onSelect={onSelectFile} />
              ))}
            </section>
          </div>
        ) : (
          <div className="space-y-3">
            <section className="space-y-1 px-2">
              <h2 className="font-mono text-[14px] font-semibold text-fg">{getRepositoryName(analysis.root)}</h2>
              <p className="font-mono text-[11px] text-fg">Framework · {frameworkNames[analysis.framework] ?? analysis.framework}</p>
              <div className="grid grid-cols-3 border-y border-line pt-2 font-mono text-[10px] text-fg">
                <div className="border-r border-line px-2 pb-2"><span className="block text-fg-muted">Files</span><span className="text-base">{analysis.stats.filesParsed}</span></div>
                <div className="border-r border-line px-2 pb-2"><span className="block text-fg-muted">Imports</span><span className="text-base">{analysis.edges.length}</span></div>
                <div className="px-2 pb-2"><span className="block text-fg-muted">Routes</span><span className="text-base">{routeDisplay}</span></div>
              </div>
            </section>
            {analysis.routes.length > 0 && <section>
              <SectionTitle>Routes · {analysis.routes.length}</SectionTitle>
              <div className="overflow-x-auto">
                <table className="w-full table-fixed border-collapse font-mono text-[10px]">
                  <thead><tr className="border-b border-line text-left text-fg-muted"><th className="w-12 px-2 py-1">Method</th><th className="px-2 py-1">Pattern</th><th className="px-2 py-1">File</th></tr></thead>
                  <tbody>{analysis.routes.map((route) => <tr key={`${route.file}:${route.method}:${route.path}`} className="border-b border-line/60 align-top">
                    <td className="px-2 py-1 text-fg">{route.method}</td>
                    <td className="break-all px-2 py-1 text-fg">{route.path}</td>
                    <td className="px-2 py-1"><button type="button" title={route.file} onClick={() => onSelectFile(route.file)} className="block w-full cursor-pointer truncate text-left text-accent">{route.file}</button></td>
                  </tr>)}</tbody>
                </table>
              </div>
            </section>}
            <section>
              <SectionTitle>Most depended on · files importing it · {mostDependedOn.length}</SectionTitle>
              {mostDependedOn.map((file) => <div key={file.path} className="flex items-center gap-2"><div className="min-w-0 flex-1"><PathButton path={file.path} onSelect={onSelectFile} /></div><span className="shrink-0 px-2 font-mono text-[10px] text-incoming">←{file.fanIn}</span></div>)}
              {mostDependedOn.length === 0 && <p className="px-2 py-1 font-mono text-[10px] text-fg-muted">No incoming imports.</p>}
            </section>
            <section>
              <SectionTitle>Nothing imports · {filesNothingImports.length}</SectionTitle>
              {filesNothingImports.map((file) => <div key={file.path} className="flex items-center gap-2"><div className="min-w-0 flex-1"><PathButton path={file.path} onSelect={onSelectFile} /></div><span className="shrink-0 px-2 font-mono text-[10px] text-outgoing">{file.fanOut} →</span></div>)}
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="border-y border-line px-2 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-fg">{children}</h3>;
}

function RelationshipList({
  title,
  paths,
  count,
  onSelect,
}: {
  title: string;
  paths: string[];
  count: number;
  onSelect: (path: string) => void;
}) {
  return (
    <section>
      <SectionTitle>{title} · {count}</SectionTitle>
      {paths.length ? paths.map((path) => (
        <PathButton key={path} path={path} onSelect={onSelect} />
      )) : <p className="px-2 py-1 font-mono text-[10px] text-fg-muted">None</p>}
    </section>
  );
}

function GraphCanvas({
  analysis,
  graph,
  focus,
  onFocusChange,
  onRegisterFileSelector,
  selectedCategory,
}: {
  analysis: ParserResult;
  graph: FoldedGraph;
  focus: GraphFocus | null;
  onFocusChange: (focus: GraphFocus | null) => void;
  onRegisterFileSelector: (selector: ((path: string) => void) | null) => void;
  selectedCategory: string | null;
}) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const flow = useReactFlow<FolderFlowNode, DependencyFlowEdge>();
  const viewport = useViewport();
  const maxZoomBeforeOpen = useRef(1);
  const needsOpenRefit = useRef(false);

  const onToggle = useCallback((folder: string) => {
    const isOpen = expandedFolders.has(folder);
    if (!isOpen) {
      maxZoomBeforeOpen.current = viewport.zoom;
      needsOpenRefit.current = true;
      onFocusChange({ nodeId: folder });
    } else if (focus?.nodeId === folder && focus.filePath) {
      onFocusChange({ nodeId: folder });
    }
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }, [expandedFolders, focus, onFocusChange, viewport.zoom]);

  const onSelectFile = useCallback((filePath: string) => {
    const nodeId = graph.fileOwners.get(filePath);
    if (!nodeId) return;
    onFocusChange({ nodeId, filePath });
    if (!expandedFolders.has(nodeId)) {
      maxZoomBeforeOpen.current = viewport.zoom;
      needsOpenRefit.current = true;
      setExpandedFolders((current) => new Set(current).add(nodeId));
    }
  }, [expandedFolders, graph, onFocusChange, viewport.zoom]);

  useEffect(() => {
    onRegisterFileSelector(onSelectFile);
    return () => onRegisterFileSelector(null);
  }, [onRegisterFileSelector, onSelectFile]);

  const relatedIds = useMemo(() => getRelatedNodeIds(graph, focus, analysis.edges), [analysis.edges, focus, graph]);
  const highlightedFiles = useMemo(() => getHighlightedFilePaths(graph, focus, analysis.edges), [analysis.edges, focus, graph]);
  const flowNodes = useMemo(
    () => getFlowNodes(graph, expandedFolders, focus, relatedIds, highlightedFiles, selectedCategory),
    [expandedFolders, focus, graph, highlightedFiles, relatedIds, selectedCategory],
  );
  const flowEdges = useMemo(
    () => getFlowEdges(graph, expandedFolders, focus, selectedCategory),
    [expandedFolders, focus, graph, selectedCategory],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<FolderFlowNode>(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<DependencyFlowEdge>(flowEdges);

  useEffect(() => setNodes(flowNodes), [flowNodes, setNodes]);
  useEffect(() => setEdges(flowEdges), [flowEdges, setEdges]);
  useEffect(() => {
    if (!needsOpenRefit.current) return;
    needsOpenRefit.current = false;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        void flow.fitView({
          padding: 0.14,
          maxZoom: maxZoomBeforeOpen.current,
          duration: 180,
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [expandedFolders, flow]);

  return (
    <FolderInteractionsContext.Provider value={{
      onToggle,
      onSelectFile,
    }}>
      <ReactFlow<FolderFlowNode, DependencyFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        // React Flow sets pointer-events: none on nodes when they are neither
        // selectable nor draggable and no node click handler is registered.
        // Keep this handler so the custom node's own click targets can receive input.
        onNodeClick={(_, node) => {
          if (expandedFolders.has(node.id)) onFocusChange({ nodeId: node.id });
          else onToggle(node.id);
        }}
        onPaneClick={() => onFocusChange(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        minZoom={0.12}
        maxZoom={1.5}
        fitView
        fitViewOptions={{ padding: 0.14, maxZoom: 1.25 }}
        defaultEdgeOptions={{ type: 'default', selectable: false }}
        proOptions={{ hideAttribution: false }}
        className="bg-canvas"
      >
        <Background variant={BackgroundVariant.Dots} color="var(--line)" gap={22} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </FolderInteractionsContext.Provider>
  );
}

function CanvasShellContent({
  analysis,
  graph,
  analysisId,
  repositoryUrl,
  tracingConfigured,
  onRoleAssigned,
}: {
  analysis: ParserResult;
  graph: FoldedGraph;
  analysisId?: string;
  repositoryUrl?: string;
  tracingConfigured?: boolean;
  onRoleAssigned: (path: string, role: string) => void;
}) {
  const kinds = countFrameworkRoles(analysis.framework, analysis.files);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [focus, setFocus] = useState<GraphFocus | null>(null);
  const [selectedTab, setSelectedTab] = useState<'structure' | 'explanation'>('structure');
  const [viewTab, setViewTab] = useState<'map' | 'routes'>('map');
  const fileSelectorRef = useRef<(path: string) => void>(() => undefined);
  const registerFileSelector = useCallback((selector: ((path: string) => void) | null) => {
    if (selector) fileSelectorRef.current = selector;
    else fileSelectorRef.current = () => undefined;
  }, []);
  return (
    <div className="grid h-full min-h-0 grid-cols-[14rem_minmax(0,1fr)_26rem] overflow-hidden bg-canvas text-fg">
      <aside aria-label="File categories" className="flex min-h-0 flex-col border-r border-line bg-surface">
        <div className="flex h-9 shrink-0 items-center border-b border-line px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
          Categories · {analysis.files.length} files
        </div>
        <div className="space-y-0.5 p-2">
          {kinds.map(({ kind, count }) => (
            <button key={kind} type="button" aria-pressed={selectedCategory === kind} onClick={() => setSelectedCategory(selectedCategory === kind ? null : kind)} className={`flex h-7 w-full cursor-pointer items-center gap-2 rounded px-2 text-left font-mono text-[11px] ${selectedCategory === kind ? 'bg-raised text-fg' : 'text-fg'}`}>
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: getKindColor(kind) }} />
              <span className="min-w-0 flex-1 truncate">{kind}</span>
              <span className="tabular-nums text-fg-muted">{count}</span>
            </button>
          ))}
        </div>
        {selectedCategory && <button type="button" onClick={() => setSelectedCategory(null)} className="px-4 pb-2 text-left font-mono text-[10px] text-accent">Clear category filter</button>}
        <div className="min-h-0 flex-1" />
      </aside>

      <main aria-label="Dependency map" className="flex min-h-0 min-w-0 flex-col bg-canvas">
        <div className="flex h-9 shrink-0 items-center border-b border-line px-3 font-mono text-[11px]">
          {(['map', 'routes'] as const).map((tab) => <button key={tab} type="button" onClick={() => setViewTab(tab)} className={`mr-4 h-full cursor-pointer border-b px-1 capitalize ${viewTab === tab ? 'border-accent text-fg' : 'border-transparent text-fg-muted'}`}>{tab === 'map' ? 'Map' : `Routes ${analysis.routes.length}`}</button>)}
          <span>{analysis.stats.filesParsed} files · {graph.nodes.length} modules · {graph.edges.length} connections</span>
        </div>
        <div className="min-h-0 min-w-0 flex-1">
          {viewTab === 'routes' ? (
            <div className="h-full overflow-auto">
              <table className="w-full border-collapse font-mono text-xs">
                <thead className="sticky top-0 bg-surface text-left text-fg-muted"><tr><th className="border-b border-line px-3 py-2">Method</th><th className="border-b border-line px-3 py-2">Pattern</th><th className="border-b border-line px-3 py-2">File</th></tr></thead>
                <tbody>{analysis.routes.map((route) => <tr key={`${route.file}:${route.method}:${route.path}`} className="border-b border-line/60"><td className="px-3 py-2">{route.method}</td><td className="px-3 py-2">{route.path}</td><td className="px-3 py-2"><button type="button" title={route.file} onClick={() => fileSelectorRef.current(route.file)} className="max-w-full cursor-pointer truncate text-accent">{route.file}</button></td></tr>)}</tbody>
              </table>
              {analysis.routes.length === 0 && <p className="p-4 font-mono text-xs text-fg-muted">No routes were extracted.</p>}
            </div>
          ) : graph.nodes.length > 0 ? (
            <ReactFlowProvider>
              <GraphCanvas
                analysis={analysis}
                graph={graph}
                focus={focus}
                onFocusChange={setFocus}
                onRegisterFileSelector={registerFileSelector}
                selectedCategory={selectedCategory}
              />
            </ReactFlowProvider>
          ) : (
            <div className="flex h-full items-center justify-center font-mono text-xs text-fg-muted">No parsed files.</div>
          )}
        </div>
      </main>

      <DetailPane
        analysis={analysis}
        graph={graph}
        analysisId={analysisId}
        repositoryUrl={repositoryUrl}
        tracingConfigured={tracingConfigured}
        onRoleAssigned={onRoleAssigned}
        focus={focus}
        selectedTab={selectedTab}
        onTabChange={setSelectedTab}
        onSelectPath={(path) => {
          if (graph.fileOwners.has(path)) fileSelectorRef.current(path);
          else if (graph.nodes.some((node) => node.id === path)) setFocus({ nodeId: path });
        }}
        onClear={() => setFocus(null)}
      />
    </div>
  );
}

export function CanvasShell({
  analysis,
  analysisId,
  repositoryUrl,
  tracingConfigured,
}: {
  analysis: ParserResult;
  analysisId?: string;
  repositoryUrl?: string;
  tracingConfigured?: boolean;
}) {
  const [currentAnalysis, setCurrentAnalysis] = useState(analysis);
  const graph = useMemo(() => foldRepository(currentAnalysis), [currentAnalysis]);
  const onRoleAssigned = useCallback((path: string, role: string) => {
    setCurrentAnalysis((current) => ({
      ...current,
      files: current.files.map((file) => file.path === path ? { ...file, kind: role } : file),
    }));
  }, []);
  return (
    <CanvasShellContent
      analysis={currentAnalysis}
      graph={graph}
      analysisId={analysisId}
      repositoryUrl={repositoryUrl}
      tracingConfigured={tracingConfigured}
      onRoleAssigned={onRoleAssigned}
    />
  );
}

