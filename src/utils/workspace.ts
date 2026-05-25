import * as vscode from 'vscode';
import * as path from 'path';

export function getWorkspaceFolders(): readonly vscode.WorkspaceFolder[] {
  return vscode.workspace.workspaceFolders ?? [];
}

export function findWorkspaceFolderForUri(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(uri);
}

export function toRelativePath(uri: vscode.Uri): string {
  const folder = findWorkspaceFolderForUri(uri);
  if (folder) {
    return path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
  }
  return uri.fsPath.replace(/\\/g, '/');
}

export function normalizeFilePath(filePath: string): string {
  return path.normalize(filePath);
}

export function filePathKey(uri: vscode.Uri): string {
  return uri.fsPath;
}

export function getConfig<T>(key: string, defaultValue: T): T {
  return vscode.workspace.getConfiguration('reviewAgent').get<T>(key, defaultValue);
}

export async function readFileText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
  } catch {
    return undefined;
  }
}
