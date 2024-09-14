const vscode = require('vscode');
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let isProgrammaticChange = false;
let isUserTyping = false;
let typingTimeout;
let typingStatusBarItem;
let previousReadOnlyState = false;  // Para restaurar el estado de readonly

function activate(context) {
  typingStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  typingStatusBarItem.hide();
  context.subscriptions.push(typingStatusBarItem);

  const startPairProgramming = vscode.commands.registerCommand('extension.startPairProgramming', async () => {
    const options = ['Create a Room', 'Join a Room'];
    const selection = await vscode.window.showQuickPick(options, {
      placeHolder: 'Select an option'
    });

    if (selection === 'Create a Room') {
      const roomCode = generateRoomCode();
      vscode.window.showInformationMessage(`Room created. Share this code to join: ${roomCode}`);
      await connectToRoom(context, roomCode);
    } else if (selection === 'Join a Room') {
      const roomCode = await vscode.window.showInputBox({
        prompt: 'Enter the room code',
        validateInput: input => (input.length === 6 && /^\d+$/.test(input)) ? null : 'Invalid room code'
      });

      if (roomCode) {
        await connectToRoom(context, roomCode);
      }
    }
  });

  context.subscriptions.push(startPairProgramming);
}

async function connectToRoom(context, roomCode) {
  try {
    const channel = supabase.channel(`pair_programming_${roomCode}`, {
      config: { broadcast: { ack: true } }
    });

    await channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        vscode.window.showInformationMessage(`Connected to room: ${roomCode}`);
      } else {
        vscode.window.showErrorMessage('Failed to connect to the room. Please try again.');
      }
    });

    const documentChangeListener = vscode.workspace.onDidChangeTextDocument(({contentChanges}) => {
      const editor = vscode.window.activeTextEditor;
      if (!isProgrammaticChange && channel) {
        let edits = contentChanges.map(edit => ({
          start: {
            line: edit.range.start.line,
            character: edit.range.start.character
          },
          end: {
            line: edit.range.end.line,
            character: edit.range.end.character
          },
          text: edit.text
        }));

        channel.send({
          type: 'broadcast',
          event: 'code_change',
          payload: edits
        });

        if (!isUserTyping) {
          isUserTyping = true;
          channel.send({
            type: 'broadcast',
            event: 'user_typing',
            payload: {
              typing: true
            }
          });
        }

        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
          isUserTyping = false;
          channel.send({
            type: 'broadcast',
            event: 'user_typing',
            payload: {
              typing: false
            }
          });
        }, 1000);
      }
    });

    context.subscriptions.push(documentChangeListener);

    channel.on('broadcast', { event: 'user_typing' }, (payload) => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        if (payload.payload.typing && !isUserTyping) {
          previousReadOnlyState = editor.options.readOnly;
          editor.options.readOnly = true;
          typingStatusBarItem.text = "A user is typing...";
          typingStatusBarItem.show();
          clearTimeout(typingTimeout);
        } else if (!payload.payload.typing) {
          typingTimeout = setTimeout(() => {
            editor.options.readOnly = previousReadOnlyState;
            typingStatusBarItem.hide();
          }, 1000);
        }
      }
    });
  } catch (error) {
    vscode.window.showErrorMessage(`Error connecting to room: ${error.message}`);
  }
}

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function deactivate() {
  if (supabase) {
    supabase.removeAllChannels();
  }
}

module.exports = {
  activate,
  deactivate
};
