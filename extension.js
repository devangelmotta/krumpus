const vscode = require('vscode');
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config')

// Configuración de Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let isProgrammaticChange = false;  // Variable de control global

function activate(context) {
  const startPairProgramming = vscode.commands.registerCommand('extension.startPairProgramming', async () => {
    const channel = supabase.channel('pair_programming', {
      config: {
        broadcast: {
          ack: true
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

    await channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        vscode.window.showInformationMessage('Connected to the pair programming channel');
      }
    });

    const documentChangeListener = vscode.workspace.onDidChangeTextDocument(event => {
      if (!isProgrammaticChange && channel) {
        const edit = event.contentChanges[0];
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
  });

  context.subscriptions.push(startPairProgramming);
}

function deactivate() {
  // Aquí no necesitamos cerrar explícitamente la conexión de Supabase
}

module.exports = {
  activate,
  deactivate
};
