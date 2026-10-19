# Aplicativo desktop

O CleanFrame para Windows e macOS roda no próprio computador, sem chave de API, servidor HTTP, upload ou dependência de serviços externos. O executável distribuído inclui seu próprio runtime. O renderer desktop bloqueia conexões de rede e não carrega fontes externas.

Para instalar e começar a usar, consulte o [README](../README.md). A interface e o servidor MCP usam o mesmo motor local; veja a [documentação do MCP](desktop-mcp.md).

## Formatos e limites

Os formatos aceitos são **JPG/JPEG, PNG, WebP e MP4/MOV/M4V convencionais**. Imagens têm limite de 256 MB; vídeos, 2 GB. Lotes podem misturar imagens e vídeos. Arquivos incompatíveis, malformados, links simbólicos, hard links e arquivos somente leitura são recusados. Uma falha individual não interrompe os demais arquivos.

JPEGs com MPF (múltiplas imagens ou ganho HDR), PNGs com extensões desconhecidas e vídeos fragmentados, criptografados ou com trilhas adicionais incompatíveis são recusados para preservar o conteúdo original.

## Integridade e escopo da limpeza

A limpeza remove blocos de EXIF pessoal, GPS, XMP, IPTC, comentários e tags de usuário suportadas pelo contêiner. Os dados comprimidos da imagem, quadros de animação e fluxos de áudio/vídeo permanecem intactos. A orientação mínima, perfis de cor e parâmetros técnicos necessários para manter a apresentação podem permanecer e são informados nos avisos. A limpeza não remove texto visível, rostos, áudio, metadados internos dos codecs (como SEI) ou datas do sistema de arquivos. O aplicativo informa a limpeza dos metadados removíveis, sem prometer anonimização completa.

Para evitar deixar o original parcialmente gravado, o motor usa um arquivo temporário na mesma pasta, inspeciona o resultado, sincroniza a gravação e substitui o caminho original por renomeação. Não mantém uma imagem de saída nem um backup. A operação requer espaço livre para o temporário e permissão de escrita na pasta. Há detecção de alterações concorrentes e trava entre instâncias. Em uma interrupção abrupta, o original continua preservado até a substituição; um temporário ou `.cleanframe.lock` pode permanecer na pasta. Uma trava de sessão interrompida só deve ser removida quando nenhuma instância estiver usando o arquivo.

## Gerar instaladores

Instale as dependências com Node.js 24 ou superior e npm:

```sh
npm ci
npm run desktop:package
```

Execute no sistema de destino. Os instaladores ficam em `release/`. O comando `npm run desktop:install` usa a subpasta `release/local-install/` e abre o instalador no Windows ou o DMG no macOS. Os atalhos na raiz do repositório também instalam as dependências antes dessa etapa.

O [workflow desktop](../.github/workflows/desktop.yml) gera pacotes de Windows e macOS por execução manual ou tags `desktop-v*`. Ao enviar uma tag `desktop-v*`, os instaladores são publicados em Releases somente após os testes e a verificação MCP. Na execução manual, ative `publish_release` para publicar; sem essa opção, os pacotes ficam nos artefatos do workflow. O Windows não usa certificado; o macOS usa assinatura ad hoc para desenvolvimento, sem notarização. Certificados de distribuição precisam ser configurados para publicação sem esses avisos. A instalação e a abertura da interface no macOS precisam de validação manual em um Mac.

## Verificar

```sh
npm run desktop:check
npm run lint
npm test
npm run desktop:build
node scripts/verify-mcp.mjs
node scripts/verify-desktop.mjs
```

`verify-mcp.mjs` testa MCP stdio com arquivos temporários reais. `verify-desktop.mjs` testa interface, arraste, IPC e um arquivo real no executável desktop.

## Versão web

A interface desktop tem seu próprio ponto de entrada (`desktop.html`). A versão web anterior inicia com `npm run dev` e tem recursos e limites distintos, descritos em [web.md](web.md).
