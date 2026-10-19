# Controle local por MCP

O CleanFrame oferece um servidor MCP por **stdio**, executado neste computador. O servidor não abre uma porta HTTP, não precisa de chave de API e não envia as imagens ou vídeos para serviços externos. O cliente MCP precisa ter acesso ao mesmo sistema de arquivos.

## Executar a partir do código

Instale as dependências e gere os executáveis com os comandos indicados no README. Configure seu cliente MCP para iniciar o bundle local:

```json
{
  "mcpServers": {
    "cleanframe": {
      "command": "node",
      "args": ["C:\\Users\\seu-usuario\\MDATARemover\\native-dist\\mcp.cjs"]
    }
  }
}
```

No macOS, use um caminho como `/Users/seu-usuario/MDATARemover/native-dist/mcp.cjs`. Use o caminho absoluto do Node em `command` se o cliente não o encontrar no PATH.

## Aplicativo instalado

O aplicativo inclui seu próprio runtime para executar o servidor stdio sem abrir a interface gráfica. Copie a configuração MCP mostrada na interface: ela inclui o executável, o caminho do servidor e `ELECTRON_RUN_AS_NODE=1`. Não é necessário instalar Node separadamente. Por exemplo, no Windows:

```json
{
  "mcpServers": {
    "cleanframe": {
      "command": "C:\\Users\\seu-usuario\\AppData\\Local\\Programs\\CleanFrame\\CleanFrame.exe",
      "args": [
        "C:\\Users\\seu-usuario\\AppData\\Local\\Programs\\CleanFrame\\resources\\app.asar\\mcp.cjs",
        "--mcp"
      ],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

No macOS, `command` aponta para `/Applications/CleanFrame.app/Contents/MacOS/CleanFrame` e o primeiro argumento para `/Applications/CleanFrame.app/Contents/Resources/app.asar/mcp.cjs`. Mantenha `--mcp` e a variável de ambiente do exemplo. Ajuste o nome e a localização ao aplicativo instalado. A configuração usa o modo Node do executável para que stdin e stdout funcionem também no Windows.

## Verificar o protocolo

Após gerar o aplicativo, `node scripts/verify-mcp.mjs` testa o bundle Node e o runtime Electron usando uma imagem PNG real em uma pasta temporária. O teste confirma a remoção de metadados no mesmo caminho, a preservação exata dos pixels comprimidos, a recusa de comandos sem confirmação e a continuidade da sessão após falhas. Para verificar uma distribuição instalada ou descompactada, acrescente `--app` seguido do caminho do executável.

## Ferramentas

| Ferramenta | Entrada | Efeito |
| --- | --- | --- |
| `supported_formats` | `{}` | Lista as extensões disponíveis no mecanismo instalado. |
| `inspect_metadata` | `{ "path": "/caminho/absoluto/foto.jpg" }` | Inspeciona sem modificar o arquivo. |
| `remove_metadata` | `{ "path": "/caminho/absoluto/foto.jpg", "confirmOverwrite": true }` | Remove os metadados e substitui o conteúdo no mesmo caminho. |
| `remove_metadata_batch` | `{ "paths": ["/caminho/absoluto/foto.jpg"], "confirmOverwrite": true }` | Processa de 1 a 100 arquivos e retorna um resultado por arquivo. |

No Windows, os caminhos usam a forma `C:\\Fotos\\foto.jpg` em strings JSON. URLs, caminhos relativos e caminhos contendo byte NUL são recusados. O servidor passa os caminhos diretamente ao mecanismo local; eles não são comandos de terminal.

As ferramentas de remoção são marcadas como destrutivas e exigem `confirmOverwrite: true`. O cliente deve respeitar a autorização do usuário, inclusive aquela já fornecida na sessão. Essa confirmação concretiza a autorização no comando MCP, sem exigir um novo diálogo do servidor. A remoção de metadados do arquivo original é irreversível; faça uma cópia antes caso queira preservar os dados.

## Interpretar a resposta

Cada resposta inclui texto JSON e o mesmo objeto em `structuredContent`. A inspeção bem-sucedida retorna `success: true` e `inspection`, incluindo o caminho, formato, tamanho, metadados encontrados e avisos. A remoção retorna `success: true` e `result`, com os tamanhos antes/depois, a contagem removida, `status` (`cleaned` ou `already_clean`) e avisos do mecanismo. Leia os avisos: dados técnicos necessários para decodificar a mídia podem permanecer.

Falhas de processamento retornam `success: false`, `isError: true` e `error` com código e mensagem. Um arquivo ausente, inválido ou sem permissão não encerra a sessão MCP. Entradas que não atendem ao schema, incluindo confirmação ausente ou falsa, são rejeitadas antes da operação.

No lote, `total`, `succeeded`, `failed` e `results` descrevem o resultado completo. A operação continua após uma falha; cada item informa seu próprio sucesso ou erro. Havendo qualquer falha, o lote retorna `success: false` e `isError: true`, mesmo que outros arquivos tenham sido limpos com sucesso.

O servidor pode ler e modificar os caminhos que seu usuário do sistema operacional puder acessar. Ele não restringe o acesso a uma pasta específica; autorize apenas os arquivos desejados no cliente MCP. Os logs de inicialização ficam em stderr, preservando stdout para o protocolo.
