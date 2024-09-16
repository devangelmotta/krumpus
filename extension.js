const vscode = require('vscode');
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let isProgrammaticChange = false;  // Variable de control global para evitar loops

function activate(context) {

  const startPairProgramming = vscode.commands.registerCommand('extension.startPairProgramming', async () => {
    // Mostrar opciones para crear, unirse o sincronización dura
    const options = ['Create a Room', 'Join a Room', 'Hard Sync'];
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
    } else if (selection === 'Hard Sync') {
      await hardSync();
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
    const changes = payload.payload;  // Asumimos que es un array de cambios
    const editor = vscode.window.activeTextEditor;
    
    if (editor) {
      isProgrammaticChange = true;  // Marcar el inicio de una edición programática
      
      editor.edit(editBuilder => {
        // Recorrer y aplicar cada cambio en el array
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
        isProgrammaticChange = false;  // Marcar el final de la edición programática
      });
    }
  });

  // Manejo del evento de sincronización dura (hard_sync)
  channel.on('broadcast', { event: 'hard_sync' }, (payload) => {
    const { content } = payload.payload;  // Todo el contenido del archivo
    const editor = vscode.window.activeTextEditor;

    if (editor) {
      isProgrammaticChange = true;

      // Reemplazar todo el contenido del archivo con la sincronización dura
      editor.edit(editBuilder => {
        const documentRange = new vscode.Range(
          editor.document.positionAt(0),  // Inicio del documento
          editor.document.positionAt(editor.document.getText().length)  // Fin del documento
        );
        editBuilder.replace(documentRange, content);  // Reemplazar todo el contenido
      }).then(() => {
        isProgrammaticChange = false;
        vscode.window.showInformationMessage('Hard sync completed successfully.');
      });
    }
  });

  await channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      vscode.window.showInformationMessage(`Connected to the pair programming room: ${roomCode}`);
    }
  });

  const documentChangeListener = vscode.workspace.onDidChangeTextDocument(({contentChanges}) => {
    const editor = vscode.window.activeTextEditor;
    if (!isProgrammaticChange && channel) {
      const changes = contentChanges.map(edit => ({
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
      
      // Enviar todos los cambios como un array
      channel.send({
        type: 'broadcast',
        event: 'code_change',
        payload: changes
      });
    }
  });

  context.subscriptions.push(documentChangeListener);
}

async function hardSync() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor found for hard sync.');
    return;
  }

  const content = editor.document.getText();  // Obtener todo el contenido del editor
  const roomCode = await vscode.window.showInputBox({
    prompt: 'Enter the room code for hard sync',
    validateInput: input => (input.length === 6 && /^\d+$/.test(input)) ? null : 'Invalid room code'
  });

  if (roomCode) {
    const channel = supabase.channel(`pair_programming_${roomCode}`, {
      config: {
        broadcast: {
          ack: true,
        },
      },
    });

    await channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        vscode.window.showInformationMessage(`Performing hard sync with room: ${roomCode}`);

        // Enviar el contenido completo del editor en una sincronización dura
        channel.send({
          type: 'broadcast',
          event: 'hard_sync',
          payload: {
            content
          }
        });
      }
    });
  }
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
