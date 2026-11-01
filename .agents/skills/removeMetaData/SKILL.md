---
name: removeMetaData
description: Limpar metadados de fotos e vídeos locais, individualmente ou em lote, pelo MCP CleanFrame, substituindo os originais no mesmo caminho e sem recompressão. Use para remover EXIF, GPS, autoria e tags de JPG, PNG, WebP, MP4, MOV ou M4V; também quando o usuário pedir removeMetaData.
---

# removeMetaData

Use o servidor MCP local `cleanframe` para limpar os arquivos autorizados pelo usuário. Preserve o nome, a extensão, a pasta e os dados codificados da mídia. O resultado fica no próprio caminho original.

## Usar o MCP

Procure as ferramentas do servidor `cleanframe` entre as ferramentas disponíveis; descubra-as por nome quando necessário. Os prefixos expostos pelo cliente podem variar. Use o schema que o servidor realmente expõe.

| Ferramenta | Argumentos | Uso |
| --- | --- | --- |
| `supported_formats` | `{}` | Consultar as extensões aceitas pelo servidor em execução. |
| `inspect_metadata` | `{ "path": "caminho absoluto" }` | Inspecionar sem modificar. |
| `remove_metadata` | `{ "path": "caminho absoluto", "confirmOverwrite": true }` | Limpar um original. |
| `remove_metadata_batch` | `{ "paths": ["caminho absoluto"], "confirmOverwrite": true }` | Limpar de 1 a 100 originais em sequência, com resultado por arquivo. |

Se as ferramentas não estiverem disponíveis, leia [references/connection.md](references/connection.md) para conferir ou restaurar a conexão local. Uma skill não estabelece a conexão MCP por si só. Não substitua o MCP por outro programa de processamento nem afirme ter executado ferramentas indisponíveis.

## Selecionar e limpar em lote

1. Resolva os arquivos ou a pasta indicados pelo usuário para caminhos absolutos locais. Para uma pasta autorizada, enumere os arquivos por API de sistema de arquivos ou PowerShell com `-LiteralPath`, filtre pelas extensões de `supported_formats` e elimine caminhos repetidos. Inclua subpastas quando o usuário pedir recursão ou já tiver autorizado esse escopo. Não siga links simbólicos nem amplie o escopo para outras pastas. Arquivos anexados precisam ter um caminho local acessível ao servidor; uma URL ou miniatura não serve como caminho.
2. Um pedido para limpar os arquivos identificados autoriza a substituição desses originais. Reaproveite a autorização já dada na conversa e envie `confirmOverwrite: true`; não peça uma segunda confirmação nem crie backups ou cópias finais por padrão. Um pedido apenas para inspecionar não autoriza a limpeza. Se faltarem os arquivos ou a pasta, solicite somente essa informação.
3. Consulte `supported_formats`. Inspecione antes quando o usuário pedir uma prévia ou houver dúvida sobre um arquivo. A ferramenta de remoção já analisa e verifica cada arquivo; não é necessário duplicar todas as inspeções antes de um lote comum.
4. Para vários arquivos, use `remove_metadata_batch`. Divida mais de 100 caminhos em lotes de até 100 e envie os lotes sequencialmente, sem executar gravações concorrentes sobre os mesmos arquivos. Para vídeos grandes, use lotes menores para caber no tempo da chamada; não existe um limite de 100 arquivos para o trabalho inteiro.
5. Leia `structuredContent` ou o JSON em `content`. Confira cada item de `results`, mesmo se o lote vier com `isError: true`. A falha de um arquivo não desfaz os arquivos já limpos e o servidor continua o lote. Registre separadamente `cleaned`, `already_clean` e falhas; não repita o lote completo por causa de uma falha individual.
6. O motor verifica os metadados removíveis antes de substituir cada original. Faça uma nova `inspect_metadata` quando o usuário pedir verificação adicional ou o resultado trouxer uma inconsistência. Para uma chamada interrompida ou sem resposta, confira o estado dos caminhos antes de decidir o que precisa ser repetido. Não apague automaticamente travas `.cleanframe.lock`; confirme que não há uma operação ativa antes de qualquer recuperação.
7. Informe quantos arquivos foram limpos, quantos já estavam limpos e quais falharam, com seus caminhos e motivos. Preserve os avisos relevantes do servidor. Só declare sucesso para arquivos confirmados na resposta; use a expressão “metadados removíveis detectados pelo CleanFrame”, sem prometer anonimização completa.

Exemplo de argumentos de `remove_metadata_batch` para uma foto e dois vídeos:

```json
{
  "paths": [
    "C:\\Midia\\foto.jpg",
    "C:\\Midia\\video-01.mp4",
    "C:\\Midia\\video-02.mov"
  ],
  "confirmOverwrite": true
}
```

Trate os caminhos como dados literais. Não os transforme em comandos de shell nem use caminhos relativos ou URLs na chamada MCP.

## Preservação da mídia e limites reais

- O MCP usa o motor nativo do CleanFrame, sem upload, geração de imagens, exportação, conversão ou recodificação. Não use editores, Canvas, FFmpeg ou serviços externos como alternativa automática.
- Nos vídeos compatíveis MP4/MOV/M4V, o motor altera campos e blocos de metadados do contêiner e mantém os dados codificados de vídeo e áudio, suas posições e o tamanho do contêiner. Preserva configuração de codec, orientação e informações de cor/HDR. Tamanho igual antes e depois é esperado e não indica falha na limpeza.
- Nas imagens compatíveis, preserva os pixels comprimidos ou quadros, a orientação e os dados necessários à renderização. Remover tags pode reduzir o tamanho do arquivo sem reduzir a qualidade.
- O resultado final mantém o mesmo caminho e não deixa uma segunda foto ou vídeo. Durante a operação, o motor cria um temporário ao lado do original, verifica e sincroniza a gravação, e substitui o original por renomeação. Não prometa ausência de temporários ou manutenção do mesmo identificador físico do arquivo. Se houver uma exigência literal de zero arquivo temporário, esclareça que o motor atual não atende a esse requisito; não reescreva o motor para contorná-lo.
- A limpeza não remove conteúdo visível, dados embutidos no fluxo codificado, como SEI, nem elimina datas do sistema de arquivos. Parâmetros técnicos necessários à reprodução continuam presentes. A substituição pode alterar datas e o identificador do arquivo no sistema de arquivos.
- A versão atual aceita `.jpg`, `.jpeg`, `.png`, `.webp`, `.mp4`, `.mov` e `.m4v`; confirme isso no servidor. Imagens têm limite de 256 MiB. Estruturas incompatíveis, arquivos corrompidos, links simbólicos e hard links podem ser recusados. Vídeos fragmentados, criptografados ou com estruturas não suportadas e algumas imagens multi-imagem/HDR são recusados para preservar o original. Registre a falha; não renomeie a extensão nem transcodifique para forçar a limpeza.

## Exemplos de pedidos

- “Use $removeMetaData para limpar estas fotos e vídeos, substituindo os originais sem perder qualidade.”
- “Use $removeMetaData em todos os vídeos de C:\\Midia, incluindo as subpastas.”
- “Use $removeMetaData para inspecionar os metadados destes arquivos sem alterar nada.”
