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
import { foldRepository, type FoldedGraph } from '@/lib/graph/folded-graph';
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
  hovered: boolean;
  dimmed: boolean;
  focusActive: boolean;
  highlightedFilePaths: string[];
  selectedFilePath: string | null;
  hoveredFilePath: string | null;
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
  onHoverFile: (filePath: string | null) => void;
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
  hoverFocus: GraphFocus | null,
  relatedIds: Set<string>,
  highlightedFiles: Set<string>,
): FolderFlowNode[] {
  const positions = getPositions(graph, expandedFolders);
  return graph.nodes.map((node) => {
    const expanded = expandedFolders.has(node.id);
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
        hovered: hoverFocus?.nodeId === node.id && focus?.nodeId !== node.id,
        dimmed: !relatedIds.has(node.id),
        focusActive: focus !== null,
        highlightedFilePaths: [...highlightedFiles],
        selectedFilePath: focus?.filePath ?? null,
        hoveredFilePath: hoverFocus?.filePath ?? null,
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
): DependencyFlowEdge[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const output: DependencyFlowEdge[] = [];

  for (const group of graph.edges) {
    const sourceNode = nodeById.get(group.from);
    const targetNode = nodeById.get(group.to);
    if (!sourceNode || !targetNode) continue;
    const sourceExpanded = expandedFolders.has(group.from);
    const targetExpanded = expandedFolders.has(group.to);
    const splitMembers = sourceExpanded || targetExpanded || focus?.filePath !== undefined;
    const members: Array<DependencyEdge | null> = splitMembers ? group.edges : [null];

    for (let index = 0; index < members.length; index += 1) {
      const member = members[index];
      const inFocusedGroup = focus?.nodeId === group.from || focus?.nodeId === group.to;
      const touchesFocusedFile = focus?.filePath !== undefined && member !== null &&
        (member.from === focus.filePath || member.to === focus.filePath);
      const dimmed = focus !== null && (focus.filePath ? !touchesFocusedFile : !inFocusedGroup);
      const isFocusedOutgoing = focus?.filePath
        ? member?.from === focus.filePath
        : focus?.nodeId === group.from;
      const isFocusedIncoming = focus?.filePath
        ? member?.to === focus.filePath
        : focus?.nodeId === group.to;
      const stroke = isFocusedOutgoing ? outgoingColor : isFocusedIncoming ? incomingColor : quietEdgeColor;

      const id = member ? `${group.id}:${member.from}:${member.to}` : group.id;
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
    const dimmed = focus !== null && (selectedFile ? !touchesFocusedFile : focus.nodeId !== folder);
    const isFocusedOutgoing = selectedFile ? member.from === selectedFile : focus?.nodeId === folder;
    const isFocusedIncoming = selectedFile ? member.to === selectedFile : focus?.nodeId === folder;
    const stroke = isFocusedOutgoing ? outgoingColor : isFocusedIncoming ? incomingColor : quietEdgeColor;
    output.push({
      id: `internal:${member.from}:${member.to}`,
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
        className={`${wrapperClass} cursor-pointer ${data.focused ? 'border-accent ring-1 ring-accent/40' : data.hovered ? 'border-accent/60' : ''} ${data.dimmed ? 'opacity-20' : 'opacity-100'}`}
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
    <div className={`${wrapperClass} ${data.focused ? 'border-accent ring-1 ring-accent/40' : data.hovered ? 'border-accent/60' : ''} ${data.dimmed ? 'opacity-20' : 'opacity-100'}`}>
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
        {data.files.map((file) => {
          const rowDimmed = data.dimmed || (data.focusActive && !data.highlightedFilePaths.includes(file.path));
          const selected = data.selectedFilePath === file.path;
          return (
            <div key={file.path} className="relative h-[25px] border-b border-line/70">
              <FileHandles file={file} />
            <button
              type="button"
              className={`nodrag flex h-full w-full items-center px-2.5 text-left font-mono text-[11px] hover:bg-raised hover:text-fg ${rowDimmed ? 'opacity-20' : 'opacity-100'} ${selected ? 'bg-accent/10 text-accent' : data.hoveredFilePath === file.path ? 'bg-raised text-fg outline outline-1 outline-accent/40' : 'text-fg'}`}
              onClick={(event) => {
                event.stopPropagation();
                interactions.onSelectFile(file.path);
              }}
              onMouseEnter={() => interactions.onHoverFile(file.path)}
              onMouseLeave={() => interactions.onHoverFile(null)}
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
  return [...counts.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => a.kind.localeCompare(b.kind));
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
  onHover,
  highlighted = false,
}: {
  path: string;
  onSelect: (path: string) => void;
  onHover: (path: string | null) => void;
  highlighted?: boolean;
}) {
  return (
    <button
      type="button"
      className={`block w-full truncate px-2 py-1 text-left font-mono text-[11px] hover:bg-raised hover:text-fg ${highlighted ? 'bg-raised text-fg outline outline-1 outline-accent/40' : 'text-fg'}`}
      title={path}
      onClick={() => onSelect(path)}
      onMouseEnter={() => onHover(path)}
      onMouseLeave={() => onHover(null)}
    >
      {path}
    </button>
  );
}

function DetailPane({
  analysis,
  graph,
  focus,
  hoverFocus,
  selectedTab,
  onTabChange,
  onSelectFile,
  onHoverFile,
  onClear,
}: {
  analysis: ParserResult;
  graph: FoldedGraph;
  focus: GraphFocus | null;
  hoverFocus: GraphFocus | null;
  selectedTab: 'structure' | 'explanation';
  onTabChange: (tab: 'structure' | 'explanation') => void;
  onSelectFile: (path: string) => void;
  onHoverFile: (path: string | null) => void;
  onClear: () => void;
}) {
  const selectedFile = focus?.filePath
    ? analysis.files.find((file) => file.path === focus.filePath) ?? null
    : null;
  const selectedFolder = focus && !focus.filePath
    ? graph.nodes.find((node) => node.id === focus.nodeId) ?? null
    : null;
  const importPaths = selectedFile
    ? analysis.edges.filter((edge) => edge.from === selectedFile.path).map((edge) => edge.to).sort()
    : [];
  const dependentPaths = selectedFile
    ? analysis.edges.filter((edge) => edge.to === selectedFile.path).map((edge) => edge.from).sort()
    : [];
  const hoverLabel = hoverFocus?.filePath ?? (hoverFocus ? graph.nodes.find((node) => node.id === hoverFocus.nodeId)?.label : null);
  const mostDependedOn = [...analysis.files]
    .filter((file) => file.fanIn > 0)
    .sort((a, b) => b.fanIn - a.fanIn || a.path.localeCompare(b.path));
  const filesNothingImports = [...analysis.files]
    .filter((file) => file.fanIn === 0)
    .sort((a, b) => a.path.localeCompare(b.path));
  const routeCount = analysis.files.filter((file) => /route|endpoint/i.test(file.kind)).length;
  const unclassifiedCount = analysis.files.filter((file) => file.kind === 'module').length;
  const folderKinds = selectedFolder ? getKindCounts(selectedFolder.files) : [];

  return (
    <aside aria-label="Details" className="flex min-h-0 flex-col border-l border-line bg-surface">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-fg">
        <span>Details</span>
        {focus && <button type="button" onClick={onClear} className="text-[9px] hover:text-accent">Clear</button>}
      </div>
      <div className="flex h-8 shrink-0 border-b border-line px-2">
        {(['structure', 'explanation'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={`border-b px-2 font-mono text-[11px] capitalize ${selectedTab === tab ? 'border-accent text-accent' : 'border-transparent text-fg hover:text-accent'}`}
          >
            {tab}
          </button>
        ))}
      </div>
      {hoverLabel && (
        <div className="shrink-0 border-b border-line bg-raised px-3 py-1.5 font-mono text-[11px] text-fg" title={hoverLabel}>
          Hovering · <span className="inline-block max-w-[180px] truncate align-bottom">{hoverLabel}</span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {selectedTab === 'explanation' ? (
          <p className="px-2 py-4 font-mono text-[10px] leading-5 text-fg-muted">No explanation yet. Explanations will appear here when available.</p>
        ) : selectedFile ? (
          <div className="space-y-3">
            <header className="space-y-1 px-2">
              <h2 className="break-all font-mono text-[11px] font-semibold text-fg">{selectedFile.path}</h2>
              <p className="font-mono text-[11px] text-fg">{selectedFile.kind} · {selectedFile.lines} lines</p>
            </header>
            <RelationshipList title="Imports" paths={importPaths} count={importPaths.length} onSelect={onSelectFile} onHover={onHoverFile} hoverPath={hoverFocus?.filePath} />
            <RelationshipList title="Imported by" paths={dependentPaths} count={dependentPaths.length} onSelect={onSelectFile} onHover={onHoverFile} hoverPath={hoverFocus?.filePath} />
          </div>
        ) : selectedFolder ? (
          <div className="space-y-3">
            <header className="space-y-1 px-2">
              <h2 className="break-all font-mono text-[11px] font-semibold text-fg">{selectedFolder.label}</h2>
              <p className="font-mono text-[11px] text-fg">{selectedFolder.files.length} files · ↓ {selectedFolder.fanIn} · ↑ {selectedFolder.fanOut}</p>
            </header>
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
                <PathButton key={file.path} path={file.path} onSelect={onSelectFile} onHover={onHoverFile} highlighted={hoverFocus?.filePath === file.path} />
              ))}
            </section>
          </div>
        ) : (
          <div className="space-y-3">
            <section className="space-y-1 px-2">
              <h2 className="font-mono text-[14px] font-semibold text-fg">{getRepositoryName(analysis.root)}</h2>
              <p className="font-mono text-[11px] text-fg">Framework · Not detected</p>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-1 font-mono text-[11px] text-fg">
                <span>Files</span><span className="text-right text-fg">{analysis.stats.filesParsed}</span>
                <span>Imports</span><span className="text-right text-fg">{analysis.coverage.importsSeen}</span>
                <span>Routes</span><span className="text-right text-fg">{routeCount}</span>
                <span>Unclassified</span><span className="text-right text-fg">{unclassifiedCount}</span>
              </div>
            </section>
            <section>
              <SectionTitle>Most depended on · {mostDependedOn.length}</SectionTitle>
              {mostDependedOn.map((file) => (
                <PathButton key={file.path} path={file.path} onSelect={onSelectFile} onHover={onHoverFile} highlighted={hoverFocus?.filePath === file.path} />
              ))}
              {mostDependedOn.length === 0 && <p className="px-2 py-1 font-mono text-[10px] text-fg-muted">No incoming imports.</p>}
            </section>
            <section>
              <SectionTitle>Nothing imports · {filesNothingImports.length}</SectionTitle>
              {filesNothingImports.map((file) => (
                <PathButton key={file.path} path={file.path} onSelect={onSelectFile} onHover={onHoverFile} highlighted={hoverFocus?.filePath === file.path} />
              ))}
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
  onHover,
  hoverPath,
}: {
  title: string;
  paths: string[];
  count: number;
  onSelect: (path: string) => void;
  onHover: (path: string | null) => void;
  hoverPath?: string;
}) {
  return (
    <section>
      <SectionTitle>{title} · {count}</SectionTitle>
      {paths.length ? paths.map((path) => (
        <PathButton key={path} path={path} onSelect={onSelect} onHover={onHover} highlighted={hoverPath === path} />
      )) : <p className="px-2 py-1 font-mono text-[10px] text-fg-muted">None</p>}
    </section>
  );
}

function GraphCanvas({
  analysis,
  graph,
  focus,
  onFocusChange,
  hoverFocus,
  onHoverChange,
  onRegisterFileSelector,
}: {
  analysis: ParserResult;
  graph: FoldedGraph;
  focus: GraphFocus | null;
  onFocusChange: (focus: GraphFocus | null) => void;
  hoverFocus: GraphFocus | null;
  onHoverChange: (focus: GraphFocus | null) => void;
  onRegisterFileSelector: (selector: ((path: string) => void) | null) => void;
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
    () => getFlowNodes(graph, expandedFolders, focus, hoverFocus, relatedIds, highlightedFiles),
    [expandedFolders, focus, graph, highlightedFiles, hoverFocus, relatedIds],
  );
  const flowEdges = useMemo(
    () => getFlowEdges(graph, expandedFolders, focus),
    [expandedFolders, focus, graph],
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
      onHoverFile: (filePath) => {
        const nodeId = filePath ? graph.fileOwners.get(filePath) : undefined;
        onHoverChange(filePath && nodeId ? { nodeId, filePath } : null);
      },
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
        onNodeMouseEnter={(_, node) => onHoverChange({ nodeId: node.id })}
        onNodeMouseLeave={() => onHoverChange(null)}
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

function CanvasShellContent({ analysis, graph }: { analysis: ParserResult; graph: FoldedGraph }) {
  const kinds = getKindCounts(analysis.files);
  const [focus, setFocus] = useState<GraphFocus | null>(null);
  const [hoverFocus, setHoverFocus] = useState<GraphFocus | null>(null);
  const [selectedTab, setSelectedTab] = useState<'structure' | 'explanation'>('structure');
  const fileSelectorRef = useRef<(path: string) => void>(() => undefined);
  const registerFileSelector = useCallback((selector: ((path: string) => void) | null) => {
    if (selector) fileSelectorRef.current = selector;
    else fileSelectorRef.current = () => undefined;
  }, []);
  return (
    <div className="grid h-full min-h-0 grid-cols-[13rem_minmax(0,1fr)_18rem] overflow-hidden bg-canvas text-fg">
      <aside aria-label="File categories" className="flex min-h-0 flex-col border-r border-line bg-surface">
        <div className="flex h-9 shrink-0 items-center border-b border-line px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
          File categories
        </div>
        <div className="space-y-0.5 p-2">
          {kinds.map(({ kind, count }) => (
            <div key={kind} className="flex h-7 items-center gap-2 rounded px-2 font-mono text-[11px] text-fg">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: getKindColor(kind) }} />
              <span className="min-w-0 flex-1 truncate">{kind}</span>
              <span className="tabular-nums text-fg-muted">{count}</span>
            </div>
          ))}
        </div>
      </aside>

      <main aria-label="Dependency map" className="flex min-h-0 min-w-0 flex-col bg-canvas">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          <span>Map</span>
          <span>{analysis.stats.filesParsed} files · {graph.nodes.length} modules · {graph.edges.length} connections</span>
        </div>
        <div className="min-h-0 min-w-0 flex-1">
          {graph.nodes.length > 0 ? (
            <ReactFlowProvider>
              <GraphCanvas
                analysis={analysis}
                graph={graph}
                focus={focus}
                onFocusChange={setFocus}
                hoverFocus={hoverFocus}
                onHoverChange={setHoverFocus}
                onRegisterFileSelector={registerFileSelector}
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
        focus={focus}
        hoverFocus={hoverFocus}
        selectedTab={selectedTab}
        onTabChange={setSelectedTab}
        onSelectFile={(path) => fileSelectorRef.current(path)}
        onHoverFile={(path) => {
          const nodeId = path ? graph.fileOwners.get(path) : undefined;
          setHoverFocus(path && nodeId ? { nodeId, filePath: path } : null);
        }}
        onClear={() => setFocus(null)}
      />
    </div>
  );
}

export function CanvasShell({ analysis }: { analysis: ParserResult }) {
  const graph = useMemo(() => foldRepository(analysis), [analysis]);
  return <CanvasShellContent analysis={analysis} graph={graph} />;
}

