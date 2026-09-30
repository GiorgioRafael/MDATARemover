# CleanFrame

Ferramenta React para inspecionar e remover metadados de imagens antes da publicação em redes sociais.

## Como funciona

- Lê EXIF, XMP, IPTC, ICC e blocos de texto no navegador.
- Exibe os campos encontrados antes da limpeza.
- Decodifica a imagem para pixels e gera um novo JPG, PNG ou WEBP sem copiar os blocos de metadados.
- Inspeciona novamente o arquivo final e só então libera o download.
- Não envia imagens para servidor algum.

Na tela inicial, clique em **Colar imagem** ou use **Ctrl + V** (**⌘ + V** no Mac) após copiar uma imagem. Ela será identificada, inspecionada e limpa automaticamente; o resultado fica disponível em **Baixar imagem limpa**. Colar texto ou um link não importa uma imagem. Se o navegador bloquear o acesso pelo botão, use o atalho de colar. A seleção de arquivos e o arraste continuam com a etapa de limpeza manual.

## Limpeza em lote

Selecione ou arraste de 2 a **100 fotos** JPG, PNG ou WEBP de até **25 MB por foto**. Clique em **Limpar fotos** para acompanhar o progresso de cada arquivo. O processamento ocorre uma foto por vez no navegador. Arquivos inválidos ou falhas individuais não interrompem as demais fotos.

Cada resultado verificado oferece **Baixar** individualmente. O botão **Baixar todas (.zip)** reúne as fotos limpas, com nomes únicos quando houver arquivos repetidos. Fotos com erro ficam fora do ZIP e podem ser tentadas novamente quando o formato e o tamanho forem válidos. O modo em lote utiliza a limpeza de metadados, sem as transformações do laboratório.

## Laboratório de robustez

O modo opcional de pesquisa gera amostras reproduzíveis com transformações visuais comuns (reenquadramento, rotação mínima, ajustes tonais, ruído e recompressão). Toda saída desse modo recebe a marca d'água visível `EXPERIMENTO ACADÊMICO · NÃO PUBLICAR` e um relatório com preset e semente.

Esse recurso foi projetado para avaliar, em ambiente controlado, um detector próprio ou um conjunto de dados autorizado. Ele não implementa otimização adversarial contra serviços de terceiros, não consulta detectores de plataformas e não garante evasão de sistemas de moderação.

## Desenvolvimento

```bash
npm install
npm run dev
```

Para validar:

```bash
npm run lint
npm test
npm run build
```

## Vercel

O projeto inclui `vercel.json`. Basta importar o repositório na Vercel; o preset Vite, o comando de build e a pasta `dist` já estão configurados.

## Formatos e limites

JPG, PNG e WEBP de até 25 MB. GIF animado e HEIC não são aceitos porque a redecodificação no navegador pode perder quadros ou não ser suportada de forma consistente.
