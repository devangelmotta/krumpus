const vscode = require('vscode');
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config')

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let isProgrammaticChange = false;  // Variable de control global

// Función debounce para reducir el número de actualizaciones enviadas al servidor
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

function activate(context) {
  const startPairProgramming = vscode.commands.registerCommand('extension.startPairProgramming', async () => {
    // Mostrar opciones para crear o unirse a una sala
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
  const channel = supabase.channel(`pair_programming_${roomCode}`, {
    config: {
      broadcast: {
        ack: true,
      },
    },
  });

  // Suscribirse al canal y escuchar cambios
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

  await channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      vscode.window.showInformationMessage(`Connected to the pair programming room: ${roomCode}`);
    }
  });

  // Nueva función para enviar cambios con debounce
  const sendCodeChange = debounce((edit) => {
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
  }, 300);  // 300ms de retraso

  const documentChangeListener = vscode.workspace.onDidChangeTextDocument(({ contentChanges }) => {
    const editor = vscode.window.activeTextEditor;
    if (!isProgrammaticChange && channel) {
      for (let index = 0; index < contentChanges.length; index++) {
        let edit = contentChanges[index];
        sendCodeChange(edit);  // Ahora se usa la función con debounce
      }
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
