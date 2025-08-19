import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

let trackingStart: number | null = null;
let currentBranch: string | null = null;
let timeLogFile: string = '';
let branchTimeMap: Record<string, number> = {};
let idleTimer: NodeJS.Timeout | null = null;
let globalContext: vscode.ExtensionContext;
let lastTrackedBranch: string | null = null;

function loadTrackedTimes() {
	try {
		if (fs.existsSync(timeLogFile)) {
			const rawData = fs.readFileSync(timeLogFile, 'utf8');
			branchTimeMap = JSON.parse(rawData);
		}
	} catch (err) {
		console.error('⚠️ Error loading branch_time_log.json:', err);
	}
}

export function activate(context: vscode.ExtensionContext) {
	console.log('🔥 Branch Time Tracker is active');

	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		vscode.window.showWarningMessage('⚠️ Please open a folder to use Branch Time Tracker.');
		return;
	}

	const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
	timeLogFile = path.join(workspacePath, 'branch_time_log.json');

	globalContext = context;

	const savedGlobal = context.globalState.get<Record<string, number>>('branchTimeMap');
	if (savedGlobal) {
		branchTimeMap = savedGlobal;
		console.log('📦 Loaded saved time data from globalState:', branchTimeMap);
	} else {
		loadTrackedTimes();
	}

	const lastBranch = context.globalState.get<string>('lastTrackedBranch');
	const lastStartTime = context.globalState.get<number>('lastTrackingStart');
	const MAX_SESSION_AGE_MS = 10 * 60 * 1000;

	if (lastBranch && lastStartTime) {
		const age = Date.now() - lastStartTime;
		if (age < MAX_SESSION_AGE_MS) {
			currentBranch = lastBranch;
			lastTrackedBranch = lastBranch;
			trackingStart = lastStartTime;
			console.log(`🔁 Resumed tracking for branch "${currentBranch}" from last session (${Math.floor(age / 1000)}s ago)`);
			resetIdleTimer();
		} else {
			console.log(`⏱️ Skipped stale session for branch "${lastBranch}", started ${Math.floor(age / 1000)}s ago`);
			context.globalState.update('lastTrackedBranch', null);
			context.globalState.update('lastTrackingStart', null);
		}
	}

	vscode.window.onDidChangeWindowState((state) => {
		if (state.focused) {
			startTrackingIfBranchFound();
		} else {
			stopAndLogTime();
		}
	});

	vscode.window.onDidChangeTextEditorSelection(() => {
		resetIdleTimer();
	});

	vscode.window.onDidChangeActiveTextEditor(() => {
		startTrackingIfBranchFound();
	});
	
	vscode.workspace.onDidChangeTextDocument(() => {
		startTrackingIfBranchFound();
	});

	let startCommand = vscode.commands.registerCommand('branchTimer.start', () => {
		startTrackingIfBranchFound();
	});
	context.subscriptions.push(startCommand);

	let showTotalTime = vscode.commands.registerCommand('branchTimer.showTotalTime', () => {
		if (Object.keys(branchTimeMap).length === 0) {
			vscode.window.showInformationMessage('📭 No tracked time found.');
			return;
		}

		const timeEntries = Object.entries(branchTimeMap)
			.map(([branch, seconds]) => {
				const hrs = Math.floor(seconds / 3600);
				const mins = Math.floor((seconds % 3600) / 60);
				const secs = seconds % 60;
				return `${branch}: ${hrs}h ${mins}m ${secs}s`;
			})
			.join('\n');

		vscode.window.showInformationMessage(`📊 Branch Time Summary:\n${timeEntries}`, { modal: true });
	});
	context.subscriptions.push(showTotalTime);

	let viewTimeReport = vscode.commands.registerCommand('branchTimer.viewTimeReport', () => {
		showTimeReportWebview(context);
	});
	context.subscriptions.push(viewTimeReport);
}

function showTimeReportWebview(context: vscode.ExtensionContext) {
	const panel = vscode.window.createWebviewPanel(
		'branchTimeReport',
		'📈 Branch Time Tracker Report',
		vscode.ViewColumn.One,
		{ enableScripts: true }
	);

	const tableRows = Object.entries(branchTimeMap).map(([branch, seconds]) => {
		const hrs = Math.floor(seconds / 3600);
		const mins = Math.floor((seconds % 3600) / 60);
		const secs = seconds % 60;
		return `<tr><td>${branch}</td><td>${hrs}h ${mins}m ${secs}s</td><td>${(seconds / 3600).toFixed(2)}</td></tr>`;
	}).join('');

	const chartData = JSON.stringify(Object.entries(branchTimeMap).map(([branch, seconds]) => ({
		branch,
		hours: parseFloat((seconds / 3600).toFixed(2))
	})));

	panel.webview.html = `
	<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8">
		<title>Branch Time Report</title>
		<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
		<style>
			body {
				font-family: "Segoe UI", Roboto, sans-serif;
				background: #fafafa;
				color: #333;
				padding: 20px;
				line-height: 1.6;
			}
			h2 {
				color: #2e3b4e;
			}
			table {
				border-collapse: collapse;
				width: 100%;
				margin-top: 20px;
				background: #fff;
				box-shadow: 0 1px 3px rgba(0,0,0,0.05);
			}
			th, td {
				padding: 10px 14px;
				border: 1px solid #ddd;
				text-align: left;
			}
			th {
				background-color: #f0f4f8;
				font-weight: 600;
			}
			tr:hover {
				background-color: #f9f9f9;
			}
			canvas {
				margin-top: 40px;
			}
		</style>
	</head>
	<body>
		<h2>🕒 Time Tracked per Git Branch</h2>
		<table>
			<tr><th>Branch Name</th><th>Time Spent</th><th>Hours (Decimal)</th></tr>
			${tableRows}
		</table>

		<canvas id="timeChart" width="600" height="300"></canvas>

		<script>
			const ctx = document.getElementById('timeChart').getContext('2d');
			const data = ${chartData};

			new Chart(ctx, {
				type: 'bar',
				data: {
					labels: data.map(d => d.branch),
					datasets: [{
						label: 'Hours Spent',
						data: data.map(d => d.hours),
						backgroundColor: 'rgba(34, 139, 34, 0.6)', // forest green
						borderColor: 'rgba(34, 139, 34, 1)',
						borderWidth: 1,
						borderRadius: 4
					}]
				},
				options: {
					responsive: true,
					scales: {
						y: {
							beginAtZero: true,
							title: {
								display: true,
								text: 'Hours',
								color: '#555',
								font: {
									weight: 'bold'
								}
							},
							ticks: {
								color: '#444'
							}
						},
						x: {
							title: {
								display: true,
								text: 'Git Branches',
								color: '#555',
								font: {
									weight: 'bold'
								}
							},
							ticks: {
								color: '#444',
								maxRotation: 45
							}
						}
					},
					plugins: {
						legend: {
							labels: {
								color: '#333'
							}
						},
						title: {
							display: true,
							text: 'Development Time by Git Branch',
							color: '#2e3b4e',
							font: {
								size: 16,
								weight: 'bold'
							}
						}
					}
				}
			});
		</script>
	</body>
	</html>
	`;
}

function startTrackingIfBranchFound() {
    const branch = getGitBranchName();
    
    if (branch) {
        if (branch === lastTrackedBranch && trackingStart) return;
        
        stopAndLogTime();
        currentBranch = branch;
        lastTrackedBranch = branch;
        trackingStart = Date.now();
        console.log(`🟢 Started tracking time for branch "${currentBranch}"`);
        resetIdleTimer();
        
        if (globalContext) {
            globalContext.globalState.update('lastTrackedBranch', currentBranch);
            globalContext.globalState.update('lastTrackingStart', trackingStart);
        }
    } else {
        console.log('⚠️ No Git branch found');
    }
}

function stopAndLogTime(isCleanExit = false) {
	if (!trackingStart || !currentBranch) return;

	const durationSec = Math.floor((Date.now() - trackingStart) / 1000);
	console.log(`🛑 Stopped tracking. Branch: "${currentBranch}", Duration: ${durationSec}s`);

	branchTimeMap[currentBranch] = (branchTimeMap[currentBranch] || 0) + durationSec;

	try {
		fs.writeFileSync(timeLogFile, JSON.stringify(branchTimeMap, null, 2));
	} catch (err) {
		console.error('❌ Error writing to branch_time_log.json:', err);
	}

	if (globalContext) {
		globalContext.globalState.update('branchTimeMap', branchTimeMap);

		if (isCleanExit) {
			globalContext.globalState.update('lastTrackedBranch', null);
			globalContext.globalState.update('lastTrackingStart', null);
		}
	}

	console.log(`📊 Total time for branch "${currentBranch}": ${branchTimeMap[currentBranch]}s`);

	trackingStart = null;
	currentBranch = null;
	clearIdleTimer();
}

function resetIdleTimer() {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = setTimeout(() => {
		console.log('💤 User went idle, auto-stopping branch time tracker.');
		stopAndLogTime();
	}, 5 * 60 * 1000);
}

function clearIdleTimer() {
	if (idleTimer) clearTimeout(idleTimer);
}

function getGitBranchName(): string | null {
	const ws = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
	if (!ws) return null;

	const gitFolder = path.join(ws, '.git');
	if (!fs.existsSync(gitFolder)) {
		console.log('⛔ Not a Git repository, branch time tracking disabled');
		return null;
	}

	try {
		const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ws })
			.toString()
			.trim();
		return branch;
	} catch {
		console.error('❌ Git error fetching current branch');
		return null;
	}
}

export function deactivate() {
	console.log('🧹 Branch Time Tracker deactivating, cleaning up...');
	stopAndLogTime(true);
}