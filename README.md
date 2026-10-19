# CleanFrame

Aplicativo para **Windows e macOS** que remove metadados de fotos e vídeos no próprio computador. Arraste os arquivos, confira os caminhos e clique em **Remover metadados**. O CleanFrame altera o arquivo original, mantém seu nome e localização e informa o resultado de cada item.

O processamento é local, sem API, conta ou upload. Não gera outra imagem nem recomprime a mídia. A interface e o controle por MCP usam o mesmo mecanismo de limpeza.

## Instalar no Windows

1. Abra a [página de downloads](https://github.com/GiorgioRafael/MDATARemover/releases/latest).
2. Na seção **Assets**, baixe o arquivo `CleanFrame-<versão>-win-x64.exe`. Para um PC com Windows em ARM, escolha `win-arm64.exe`, quando disponível.
3. Execute o instalador. Ele instala o CleanFrame para o seu usuário e cria um atalho. Depois, abra **CleanFrame** pelo menu Iniciar ou pela área de trabalho.

O aplicativo distribuído já inclui tudo de que precisa. Não é necessário instalar Node.js, Python, FFmpeg ou ExifTool.

## Instalar no macOS

1. Abra a [página de downloads](https://github.com/GiorgioRafael/MDATARemover/releases/latest).
2. Na seção **Assets**, baixe `CleanFrame-<versão>-mac-arm64.dmg` para Apple Silicon ou `CleanFrame-<versão>-mac-x64.dmg` para Intel. Veja o tipo do seu Mac em **menu Apple → Sobre Este Mac**.
3. Abra o `.dmg` e arraste **CleanFrame** para **Applications / Aplicativos**.
4. Abra **CleanFrame** na pasta Aplicativos. Depois, ejete o disco de instalação.

Os pacotes atuais não têm certificado de distribuição no Windows; no macOS, usam assinatura ad hoc e ainda não têm notarização. O sistema pode alertar ou bloquear a abertura. Confira a origem do download; para distribuição sem esses avisos, os pacotes precisam de assinatura de distribuição e, no Mac, notarização. A instalação e a abertura da interface no macOS precisam de validação manual em um Mac.

Se ainda não houver uma release publicada para seu sistema, use a instalação pelo código abaixo.

## Instalar pelo código com um atalho

Esta opção gera o instalador no seu computador. Requer **Node.js 24 ou superior com npm**, instalado pelo [site oficial do Node.js](https://nodejs.org/en/download), além de internet para baixar as dependências na primeira instalação.

1. Baixe este repositório pelo botão **Code → Download ZIP** e extraia a pasta, ou clone com Git.
2. No Windows, dê dois cliques em **[Instalar-Windows.cmd](Instalar-Windows.cmd)**.
3. No macOS, abra **[Instalar-macOS.command](Instalar-macOS.command)**. Se o arquivo não executar diretamente, abra o Terminal na pasta extraída e rode:

   ```sh
   sh ./Instalar-macOS.command
   ```

O atalho verifica o Node.js, instala as dependências com `npm ci`, compila o aplicativo e abre o instalador correspondente ao sistema. No Windows, aguarde a instalação; no Mac, arraste o aplicativo do DMG para Aplicativos. O atalho não instala o Node.js automaticamente.

Se as dependências já estiverem instaladas, o comando equivalente para gerar e abrir o instalador é:

```sh
npm run desktop:install
```

Depois de instalado, o CleanFrame funciona **offline** e não precisa manter esta pasta de código aberta.

## Usar

1. Arraste uma foto, um vídeo ou um lote para a janela; você também pode usar o seletor de arquivos.
2. Confira os caminhos exibidos: são os arquivos que serão alterados.
3. Clique em **Remover metadados** e acompanhe o resultado de cada arquivo.

A limpeza substitui o conteúdo **no mesmo caminho** e não mantém backup. Se quiser preservar os metadados originais, faça uma cópia antes. O mecanismo prepara e verifica um arquivo temporário na mesma pasta antes da substituição; por isso, precisa de espaço livre e permissão de escrita nessa pasta.

Suporta **JPG/JPEG, PNG e WebP de até 256 MB**, além de **MP4, MOV e M4V convencionais de até 2 GB**. Os dados comprimidos da imagem e os fluxos de áudio e vídeo são preservados. Informações técnicas necessárias à reprodução podem permanecer; a limpeza não altera conteúdo visível ou audível. Veja [formatos, limites e integridade da limpeza](docs/desktop.md).

## Conectar por MCP

Abra o aplicativo e clique em **Conectar MCP**. Copie a configuração exibida para seu cliente MCP: ela contém os caminhos corretos deste computador e usa o runtime incluído no aplicativo instalado.

O servidor funciona localmente por **stdio**, sem servidor HTTP ou chave de API. Oferece `inspect_metadata`, `remove_metadata`, `remove_metadata_batch` e `supported_formats`. Consulte a [configuração e os exemplos de MCP](docs/desktop-mcp.md).

## Desenvolvimento e verificação

Com Node.js 24 ou superior, na pasta do repositório:

```sh
npm ci
npm run desktop
```

Esse comando compila e abre a interface desktop sem instalar o aplicativo. Para verificar o código:

```sh
npm run desktop:check
npm run lint
npm test
```

Após `npm run desktop:build`, verifique MCP e interface com arquivos temporários reais:

```sh
node scripts/verify-mcp.mjs
node scripts/verify-desktop.mjs
```

Para gerar pacotes sem iniciar a instalação, use `npm run desktop:package` no sistema de destino. Os arquivos ficam em `release/`. Veja os [detalhes do aplicativo desktop](docs/desktop.md) e a [documentação da versão web anterior](docs/web.md).
