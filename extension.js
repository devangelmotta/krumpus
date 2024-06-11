const vscode = require('vscode');
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config')

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let isProgrammaticChange = false;  // Variable de control global
let isUserTyping = false;  // Indica si el usuario local está escribiendo
let typingTimeout;  // Timeout para desbloquear la escritura
let typingStatusBarItem;  // Elemento de la barra de estado para mostrar el mensaje de escritura

const outputChannel = vscode.window.createOutputChannel('Pair Programming');

function activate(context) {
  // Crear el StatusBarItem
  typingStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  typingStatusBarItem.hide();
  context.subscriptions.push(typingStatusBarItem);

  const startPairProgramming = vscode.commands.registerCommand('extension.startPairProgramming', async () => {
    // Mostrar opciones para crear o unirse a una sala
    const options = ['Create a Room', 'Join a Room'];
    const selection = await vscode.window.showQuickPick(options, {
      placeHolder: 'Select an option'
    });

    if (selection === 'Create a Room') {
      const roomCode = generateRoomCode();
      vscode.window.showInformationMessage(`Room created. Share this code to join: ${roomCode}`);
      outputChannel.appendLine(`Room code: ${roomCode}`);

      await connectToRoom(context, roomCode);
    } else if (selection === 'Join a Room') {
      const roomCode = await vscode.window.showInputBox({
        prompt: 'Enter the room code',
        validateInput: input => (input.length === 6 && /^\d+$/.test(input)) ? null : 'Invalid room code'
      });

      if (roomCode) {
        await connectToRoom(context, roomCode);
        outputChannel.show();
      }
    }
  });

  context.subscriptions.push(startPairProgramming);
}

async function connectToRoom(context, roomCode) {
  const channel = supabase.channel(`pair_programming_${roomCode}`, {
    config: {
      broadcast: {
        ack: true,
      },
    },
  });

  // Suscribirse al canal
  channel.on('broadcast', { event: 'code_change' }, (payload) => {
    const edit = payload.payload;
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      isProgrammaticChange = true;  // Marcar el inicio de una edición programática
      editor.edit(editBuilder => {
        editBuilder.replace(new vscode.Range(
          new vscode.Position(edit.start.line, edit.start.character),
          new vscode.Position(edit.end.line, edit.end.character)
        ), edit.text);
      }).then(() => {
        isProgrammaticChange = false;  // Marcar el final de una edición programática
      });
    }
  });

  channel.on('broadcast', { event: 'user_typing' }, (payload) => {
    if (payload.payload.typing && !isUserTyping) {
      vscode.window.activeTextEditor.options.readOnly = true;
      typingStatusBarItem.text = "A is typing...";
      typingStatusBarItem.show();
      clearTimeout(typingTimeout);
    } else if (!payload.payload.typing) {
      typingTimeout = setTimeout(() => {
        vscode.window.activeTextEditor.options.readOnly = false;
        typingStatusBarItem.hide();
      }, 1000);
    }
  });

  await channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      vscode.window.showInformationMessage(`Connected to the pair programming room: ${roomCode}`);
      //outputChannel.appendLine(`Connected to the pair programming room: ${roomCode}`);
    }
  });

  const documentChangeListener = vscode.workspace.onDidChangeTextDocument(event => {
    // Ignorar cambios en el canal de salida y otros documentos que no sean el activo principal
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== event.document) {
      return;
    }

    if (!isProgrammaticChange && channel) {
      const edit = event.contentChanges[0];

      // Enviar evento de "user_typing"
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

      // Enviar evento de "code_change"
      channel.send({
        type: 'broadcast',
        event: 'code_change',
        payload: {
          start: {
            line: edit.range.start.line,
            character: edit.range.start.character
          },
          end: {
            line: edit.range.end.line,
            character: edit.range.end.character
          },
          text: edit.text
        }
      });
    }
  });

  context.subscriptions.push(documentChangeListener);
}

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function deactivate() {
  // Aquí no necesitamos cerrar explícitamente la conexión de Supabase
}

module.exports = {
  activate,
  deactivate
};
