const vscode = require('vscode');
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config');

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let isProgrammaticChange = false;
let isUserTyping = false;
let typingTimeout;
let typingStatusBarItem;

function activate(context) {
    initializeStatusBar(context);
    registerCommands(context);
}

function initializeStatusBar(context) {
    typingStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    typingStatusBarItem.hide();
    context.subscriptions.push(typingStatusBarItem);
}

function registerCommands(context) {
    const startPairProgrammingCommand = vscode.commands.registerCommand('extension.startPairProgramming', handlePairProgrammingCommand);
    context.subscriptions.push(startPairProgrammingCommand);
}

async function handlePairProgrammingCommand() {
    const options = ['Create a Room', 'Join a Room'];
    const selection = await vscode.window.showQuickPick(options, { placeHolder: 'Select an option' });

    if (selection === 'Create a Room') {
        const roomCode = generateRoomCode();
        vscode.window.showInformationMessage(`Room created. Share this code to join: ${roomCode}`);
        await connectToRoom(roomCode);
    } else if (selection === 'Join a Room') {
        const roomCode = await vscode.window.showInputBox({
            prompt: 'Enter the room code',
            validateInput: validateRoomCode
        });

        if (roomCode) {
            await connectToRoom(roomCode);
        }
    }
}

async function connectToRoom(roomCode) {
    const channel = createSupabaseChannel(roomCode);

    channel.on('broadcast', { event: 'code_change' }, handleCodeChange);
    channel.on('broadcast', { event: 'user_typing' }, handleUserTyping);

    await channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            vscode.window.showInformationMessage(`Connected to the pair programming room: ${roomCode}`);
        }
    });

    const documentChangeListener = vscode.workspace.onDidChangeTextDocument(handleDocumentChange);
    context.subscriptions.push(documentChangeListener);
}

function createSupabaseChannel(roomCode) {
    return supabaseClient.channel(`pair_programming_${roomCode}`, {
        config: { broadcast: { ack: true } }
    });
}

function handleCodeChange(payload) {
    const edit = payload.payload;
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        isProgrammaticChange = true;
        editor.edit(editBuilder => {
            editBuilder.replace(
                new vscode.Range(
                    new vscode.Position(edit.start.line, edit.start.character),
                    new vscode.Position(edit.end.line, edit.end.character)
                ), edit.text
            );
        }).then(() => {
            isProgrammaticChange = false;
        });
    }
}

function handleUserTyping(payload) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    if (payload.payload.typing && !isUserTyping) {
        setEditorReadOnly(true);
        showTypingStatus("A is typing...");
    } else if (!payload.payload.typing) {
        typingTimeout = setTimeout(() => {
            setEditorReadOnly(false);
            hideTypingStatus();
        }, 1000);
    }
}

function handleDocumentChange({ contentChanges }) {
    const editor = vscode.window.activeTextEditor;
    if (!isProgrammaticChange && contentChanges.length > 0) {
        const edit = contentChanges[0];
        broadcastUserTyping();
        broadcastCodeChange(edit);
    }
}

function broadcastUserTyping() {
    if (!isUserTyping) {
        isUserTyping = true;
        sendTypingEvent(true);
    }

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        isUserTyping = false;
        sendTypingEvent(false);
    }, 1000);
}

function broadcastCodeChange(edit) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        sendCodeChangeEvent({
            start: { line: edit.range.start.line, character: edit.range.start.character },
            end: { line: edit.range.end.line, character: edit.range.end.character },
            text: edit.text
        });
    }
}

function sendTypingEvent(isTyping) {
    supabaseClient.channel.send({
        type: 'broadcast',
        event: 'user_typing',
        payload: { typing: isTyping }
    });
}

function sendCodeChangeEvent(edit) {
    supabaseClient.channel.send({
        type: 'broadcast',
        event: 'code_change',
        payload: edit
    });
}

function setEditorReadOnly(isReadOnly) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        editor.options.readOnly = isReadOnly;
    }
}

function showTypingStatus(message) {
    typingStatusBarItem.text = message;
    typingStatusBarItem.show();
}

function hideTypingStatus() {
    typingStatusBarItem.hide();
}

function generateRoomCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function validateRoomCode(input) {
    return input.length === 6 && /^\d+$/.test(input) ? null : 'Invalid room code';
}

function deactivate() {}

module.exports = { activate, deactivate };
