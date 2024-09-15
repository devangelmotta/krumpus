const vscode = require('vscode');
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config')

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let isProgrammaticChange = false;  // Variable de control global
let changeBuffer = [];  // Buffer para almacenar cambios
//let bufferTimer = null;  // Temporizador del buffer

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
    const changes = payload.payload;  // Ahora asumimos que es un array de cambios
    const editor = vscode.window.activeTextEditor;
    
    if (editor) {
      isProgrammaticChange = true;  // Marcar el inicio de una edición programática
      
      editor.edit(editBuilder => {
        // Recorrer cada cambio en el array y aplicarlo
        changes.forEach(change => {
          editBuilder.replace(
            new vscode.Range(
              new vscode.Position(change.start.line, change.start.character),
              new vscode.Position(change.end.line, change.end.character)
            ),
            change.text
          );
        });
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

  // Nueva función para enviar el buffer de cambios
  const sendBufferedChanges = () => {
    if (changeBuffer.length > 0) {
      const batchedChanges = changeBuffer.map(edit => ({
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
        payload: batchedChanges
      });

      changeBuffer = [];  // Limpiar el buffer después de enviar
    }
  };

  // Debounce para enviar el buffer después de 300ms de inactividad
  const sendChangesWithDebounce = debounce(sendBufferedChanges, 300);

  const documentChangeListener = vscode.workspace.onDidChangeTextDocument(({ contentChanges }) => {
    const editor = vscode.window.activeTextEditor;
    if (!isProgrammaticChange && channel) {
      // Agregar los cambios al buffer
      contentChanges.forEach(change => {
        changeBuffer.push(change);
      });

      // Reiniciar el temporizador de debounce
      sendChangesWithDebounce();
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
