const vscode = require('vscode');
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let isProgrammaticChange = false;  // Variable de control global para evitar loops
let currentChannel = null;  // Variable para guardar el canal activo de la sala
let typingTimeout = null;  // Para controlar cuándo se detiene la notificación de escritura
let isEditorLocked = false;  // Para bloquear la edición cuando el otro usuario está escribiendo
let currentUsername = "UserA"; // Nombre del usuario actual (cambiar según sea necesario)
let typingStatusBar;  // Variable para la barra de estado que muestra el estado de "typing"

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

  // Registrar el comando de sincronización dura
  const hardSyncCommand = vscode.commands.registerCommand('extension.hardSync', async () => {
    await hardSync();
  });

  // Crear un botón en la barra de estado para "Hard Sync"
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'extension.hardSync';  // Asociar el comando de sincronización dura
  statusBarItem.text = '$(sync) Hard Sync';  // Texto del botón con un ícono
  statusBarItem.tooltip = 'Perform a hard sync of the current editor';
  statusBarItem.show();  // Mostrar el botón en la barra de estado
  context.subscriptions.push(statusBarItem, startPairProgramming, hardSyncCommand);

  // Crear y mostrar la barra de estado para el estado de "escritura"
  typingStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  typingStatusBar.hide();  // Ocultar inicialmente
  context.subscriptions.push(typingStatusBar);
}

async function connectToRoom(context, roomCode) {
  currentChannel = supabase.channel(`pair_programming_${roomCode}`, {
    config: {
      broadcast: {
        ack: true,
      },
    },
  });

  // Suscribirse al canal
  currentChannel.on('broadcast', { event: 'code_change' }, (payload) => {
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
  currentChannel.on('broadcast', { event: 'hard_sync' }, (payload) => {
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

  // Manejo del evento de escritura "typing"
  currentChannel.on('broadcast', { event: 'typing' }, (payload) => {
    const { username, isTyping } = payload.payload;

    if (isTyping) {
      typingStatusBar.text = `$(pencil) ${username} is typing...`;
      typingStatusBar.show();  // Mostrar la barra de estado con el mensaje
      isEditorLocked = true;  // Bloquear la edición
    } else {
      typingStatusBar.hide();  // Ocultar la barra de estado cuando el usuario deja de escribir
      isEditorLocked = false;  // Desbloquear la edición
    }
  });

  await currentChannel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      vscode.window.showInformationMessage(`Connected to the pair programming room: ${roomCode}`);
    }
  });

  const documentChangeListener = vscode.workspace.onDidChangeTextDocument(({contentChanges}) => {
    const editor = vscode.window.activeTextEditor;
    
    if (!isEditorLocked && !isProgrammaticChange && currentChannel) {  // Revisar si el editor no está bloqueado
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
      currentChannel.send({
        type: 'broadcast',
        event: 'code_change',
        payload: changes
      });

      // Notificar que el usuario está escribiendo
      notifyTyping(true);

      // Reiniciar el temporizador para detener la notificación de escritura
      if (typingTimeout) {
        clearTimeout(typingTimeout);
      }
      typingTimeout = setTimeout(() => {
        notifyTyping(false);  // Dejar de notificar después de un tiempo sin cambios
      }, 2000);
    }
  });

  context.subscriptions.push(documentChangeListener);
}

// Función para notificar sobre el estado de escritura
function notifyTyping(isTyping) {
  if (currentChannel) {
    currentChannel.send({
      type: 'broadcast',
      event: 'typing',
      payload: {
        username: currentUsername,  // Usuario que está escribiendo
        isTyping
      }
    });
  }
}

async function hardSync() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor found for hard sync.');
    return;
  }

  if (!currentChannel) {
    vscode.window.showErrorMessage('No active room found for hard sync.');
    return;
  }

  const content = editor.document.getText();  // Obtener todo el contenido del editor

  vscode.window.showInformationMessage(`Performing hard sync with the current room`);

  // Enviar el contenido completo del editor en una sincronización dura
  currentChannel.send({
    type: 'broadcast',
    event: 'hard_sync',
    payload: {
      content
    }
  });
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
