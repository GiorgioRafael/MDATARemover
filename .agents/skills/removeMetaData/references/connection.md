# Conexão local do CleanFrame

Leia somente se as ferramentas `cleanframe` estiverem indisponíveis ou a conexão falhar.

## Skill e servidor deste repositório

A skill está em `.agents/skills/removeMetaData` e pode ser usada pelo Codex ao trabalhar neste repositório. O servidor MCP é o mesmo do aplicativo nativo: `native/mcp-entry.ts`, compilado para `native-dist/mcp.cjs`. O bundle é gerado a partir do código versionado e não precisa ser incluído no Git.

Com Node.js 24 ou superior e npm, execute na raiz do repositório:

```sh
npm ci
npm run desktop:build
```

Os comandos geram o servidor e o aplicativo desktop sem abrir a interface. Se o bundle já existir e estiver atualizado, não é necessário recompilar para cada uso.

## Conferir ou registrar no Codex

Consulte apenas o servidor relevante:

```sh
codex mcp get cleanframe --json
```

Se existir uma conexão válida, preserve-a. Ela pode apontar para o aplicativo instalado ou para um bundle autocontido de uma instalação pessoal da skill. Verifique se `command` e os caminhos em `args` existem antes de alterar a configuração.

Se o registro estiver ausente, use o bundle compilado. No PowerShell, a partir da raiz do repositório:

```powershell
$cleanframeNode = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$cleanframeBundle = (Resolve-Path -LiteralPath '.\native-dist\mcp.cjs').Path
codex mcp add cleanframe -- $cleanframeNode $cleanframeBundle
```

No macOS, a partir da raiz do repositório:

```sh
codex mcp add cleanframe -- "$(command -v node)" "$PWD/native-dist/mcp.cjs"
```

Para lotes de vídeos, ajuste `tool_timeout_sec = 3600` na seção `[mcp_servers.cleanframe]` do arquivo `config.toml` do Codex, preservando as demais configurações. Por exemplo, com caminhos absolutos ajustados ao computador:

```toml
[mcp_servers.cleanframe]
command = "C:/caminho/para/node.exe"
args = ["C:/caminho/para/MDATARemover/native-dist/mcp.cjs"]
tool_timeout_sec = 3600
```

O arquivo de configuração fica em `$CODEX_HOME/config.toml` ou, quando essa variável não está definida, em `~/.codex/config.toml`. O tempo é o limite de cada chamada, não uma garantia de duração; reduza o tamanho dos lotes para vídeos grandes.

Após alterar a configuração, reinicie o Codex para carregar a conexão. Não encerre o aplicativo automaticamente enquanto houver trabalho aberto. Confirme o funcionamento chamando `supported_formats` e, se necessário, `inspect_metadata` em um arquivo autorizado; nenhuma dessas chamadas modifica a mídia.

O bundle usa Node diretamente, não precisa abrir a interface do CleanFrame e não usa HTTP nem chave de API. Se usar o executável Electron instalado, siga a [configuração do aplicativo instalado](../../../../docs/desktop-mcp.md#aplicativo-instalado), incluindo `ELECTRON_RUN_AS_NODE=1`; não invente caminhos de instalação.

## Uso pessoal fora do repositório

Para instalar a skill para outros projetos, copie a pasta `removeMetaData` para o diretório de skills do Codex, em `$CODEX_HOME/skills` ou `~/.codex/skills`. A conexão MCP precisa continuar apontando para um servidor existente.

Para uma instalação independente da pasta do projeto, copie também `native-dist/mcp.cjs` para `assets/cleanframe-mcp.cjs` dentro da skill instalada e registre o servidor com o caminho absoluto dessa cópia. O bundle inclui suas dependências; o runtime Node precisa continuar instalado. Não substitua uma instalação pessoal existente sem conferir seu conteúdo e a configuração em uso.

Uma atualização do projeto não atualiza automaticamente uma cópia independente do bundle. Quando a atualização do MCP for solicitada, recompile com `npm run desktop:build` e atualize somente a cópia correspondente. Preserve as instruções e a configuração do usuário e confira os schemas do servidor em execução.
