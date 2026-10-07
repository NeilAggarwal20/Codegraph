import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

const execFileAsync = promisify(execFile);
const githubApi = 'https://api.github.com';
const maximumArchiveBytes = 100 * 1024 * 1024;

export interface GitHubRepository {
  owner: string;
  name: string;
  url: string;
}

export interface GitHubRepositoryInfo extends GitHubRepository {
  defaultBranch: string;
  commitSha: string;
}

/**
 * Validates an HTTPS GitHub repository URL and normalizes its owner, name, and URL.
 * Removes a trailing .git suffix and rejects credentials, query strings, and fragments.
 * @throws If the URL or either repository path segment is unsupported.
 */
export function parseGitHubRepositoryUrl(input: string): GitHubRepository {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Enter a valid public GitHub repository URL.');
  }

  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) {
    throw new Error('Only public repositories hosted at https://github.com are supported.');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) throw new Error('Use a repository URL in the form https://github.com/owner/repository.');

  const owner = segments[0];
  const rawName = segments[1].replace(/\.git$/i, '');
  const validSegment = /^[a-zA-Z0-9_.-]+$/;
  if (!validSegment.test(owner) || !validSegment.test(rawName) || owner === '.' || owner === '..' || rawName === '.' || rawName === '..') {
    throw new Error('The GitHub repository URL contains an invalid owner or repository name.');
  }

  const normalizedOwner = owner.toLowerCase();
  const normalizedName = rawName.toLowerCase();
  return {
    owner: normalizedOwner,
    name: normalizedName,
    url: `https://github.com/${normalizedOwner}/${normalizedName}`,
  };
}

/** Fetches public GitHub JSON with a 30-second timeout and descriptive HTTP or network errors. */
async function githubJson<T>(url: string, notFoundMessage: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Codegraph repository mapper',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(`Could not reach GitHub: ${error instanceof Error ? error.message : 'network request failed.'}`);
  }
  if (response.status === 404) throw new Error(notFoundMessage);
  if (response.status === 403 || response.status === 429) throw new Error('GitHub refused the request or its public API rate limit was reached. Try again later.');
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status} while reading repository metadata.`);
  return await response.json() as T;
}

/** Resolves a public repository's default branch to a validated commit SHA via GitHub's API. */
export async function resolveGitHubRepository(repository: GitHubRepository): Promise<GitHubRepositoryInfo> {
  const metadata = await githubJson<{
    private: boolean;
    full_name: string;
    default_branch: string;
  }>(`${githubApi}/repos/${repository.owner}/${repository.name}`, 'GitHub could not find that public repository.');

  if (metadata.private) throw new Error('Private repositories are not supported.');
  if (!metadata.default_branch || !/^[a-zA-Z0-9._/-]+$/.test(metadata.default_branch) || metadata.default_branch.includes('..')) {
    throw new Error('GitHub returned an invalid default branch name.');
  }

  const branchCommit = await githubJson<{ sha: string }>(
    `${githubApi}/repos/${repository.owner}/${repository.name}/commits/${encodeURIComponent(metadata.default_branch)}`,
    'GitHub could not resolve the repository default branch to a commit.',
  );
  if (!/^[a-f0-9]{40}$/i.test(branchCommit.sha)) throw new Error('GitHub returned an invalid commit identifier.');

  return {
    ...repository,
    defaultBranch: metadata.default_branch,
    commitSha: branchCommit.sha,
  };
}

/**
 * Downloads the selected commit archive and extracts it into destination/repository.
 * Limits the compressed download to 100 MiB; download and extraction each have a timeout.
 * The caller must supply an existing workspace and clean up downloaded and extracted files.
 * @throws If downloading, writing, or extracting the archive fails.
 */
export async function downloadAndExtractRepository(
  repository: GitHubRepositoryInfo,
  destination: string,
): Promise<void> {
  const archivePath = path.join(destination, 'repository.tar.gz');
  const response = await fetch(
    `https://codeload.github.com/${repository.owner}/${repository.name}/tar.gz/${repository.commitSha}`,
    { headers: { 'User-Agent': 'Codegraph repository mapper' }, signal: AbortSignal.timeout(120_000) },
  );
  if (!response.ok) throw new Error(`GitHub archive download returned HTTP ${response.status}.`);
  if (!response.body) throw new Error('GitHub returned an empty repository archive.');

  let bytesReceived = 0;
  const sizeLimit = new Transform({
    /** Forwards archive chunks until their cumulative size exceeds the download limit. */
    transform(chunk: Buffer, _encoding, callback) {
      bytesReceived += chunk.byteLength;
      if (bytesReceived > maximumArchiveBytes) {
        callback(new Error('Repository archive exceeds the 100 MB download limit.'));
        return;
      }
      callback(null, chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
    sizeLimit,
    createWriteStream(archivePath, { flags: 'wx' }),
  );

  const extractedRoot = path.join(destination, 'repository');
  await mkdir(extractedRoot);
  try {
    await execFileAsync('tar', [
      '-xzf', archivePath,
      '-C', extractedRoot,
      '--strip-components=1',
      '--no-same-owner',
      '--no-same-permissions',
    ], { timeout: 120_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  } catch (error) {
    const details = error instanceof Error ? error.message : 'archive extraction failed.';
    throw new Error(`Could not safely extract the GitHub archive: ${details}`);
  }
}

/** Creates a unique directory under the system temporary directory and returns its path. */
export async function createRepositoryWorkspace(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), 'codegraph-repository-'));
}

/** Recursively removes a repository workspace, tolerating missing paths and retrying transient failures. */
export async function removeRepositoryWorkspace(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
