import * as vscode from 'vscode';
import { ReviewSession } from '../session/reviewSession';

export class StatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly session: ReviewSession) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'reviewAgent.openAllChanges';

    session.onDidChange(() => this.update());
    this.update();
    this.item.show();
  }

  update(): void {
    const count = this.session.getChangedFiles().length;

    if (count === 0) {
      this.item.text = '$(diff) Redline';
      this.item.tooltip = 'No local changes';
    } else {
      this.item.text = `$(diff) Reviewing (${count} ${count === 1 ? 'file' : 'files'})`;
      this.item.tooltip = 'Click to open unified review of all changes';
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
