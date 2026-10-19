## Versão web existente

Os recursos descritos a seguir pertencem à versão web anterior, iniciada com `npm run dev`. A interface desktop tem seu próprio ponto de entrada (`desktop.html`) e não usa os recursos de geração, ampliação ou download da versão web.

Ferramenta React para inspecionar e remover metadados de imagens e vídeos antes da publicação em redes sociais.

## Vídeos sem perda de qualidade

Escolha a aba **Vídeos**, selecione ou arraste um **MP4, MOV ou M4V** de até **2 GB** e clique em **Remover metadados do vídeo**. Depois da verificação, use **Baixar vídeo limpo**. O processamento é local, um vídeo por vez, e pode ser cancelado.

A limpeza edita apenas o contêiner: remove tags de usuário (como GPS, autoria, título e comentários), datas de criação/modificação e nomes descritivos de faixas e codificadores. Os dados codificados de vídeo e áudio são preservados byte a byte, sem decodificação ou recompressão. A resolução, duração, rotação, cores e informações técnicas necessárias à reprodução permanecem intactas.

Os blocos removidos são substituídos por preenchimento zerado de mesmo tamanho. Por isso, o arquivo final mantém o tamanho e as posições originais dos dados de mídia. O aplicativo lê os cabeçalhos por partes e usa recortes de `Blob`, sem carregar os quadros do vídeo na memória. A saída passa por uma nova inspeção antes de liberar o download.

O suporte contempla arquivos convencionais, autocontidos, com faixas de vídeo e áudio. Contêineres fragmentados, criptografados, com referências externas, trilhas de telemetria, legendas, timecode ou extensões não reconhecidas são recusados quando a limpeza segura não pode ser confirmada. A reprodução da prévia depende dos codecs disponíveis no navegador; o processamento não precisa reproduzir o vídeo.

A verificação cobre os metadados removíveis do contêiner. Informações embutidas no fluxo codificado (por exemplo, mensagens SEI), conteúdo visível ou audível e datas do sistema de arquivos ficam fora desse escopo. Esse limite permite preservar exatamente os dados originais de vídeo e áudio.

Referência de estrutura: [QuickTime File Format, Apple](https://developer.apple.com/documentation/quicktime-file-format).

## Melhoria de qualidade

Na tela inicial, escolha **2× · recomendada** ou **4× · mais resolução** em **Melhorar qualidade com IA**. A opção vale para arquivos selecionados, imagens coladas e lotes de até 100 fotos. A limpeza de metadados permanece ativa, e cada arquivo ampliado é inspecionado antes do download individual ou em ZIP. Após limpar uma imagem, também é possível selecionar uma ampliação e clicar em **Aplicar melhoria**; o processamento parte do original.

O site executa **Real-ESRGAN general-x4v3** no próprio navegador, com pesos oficiais e redução de ruído em 50% (equilíbrio entre textura e suavização). O modelo ONNX de 4,9 MB e o runtime são carregados apenas ao ativar o upscale. WebGPU acelera a execução quando disponível; a CPU via WebAssembly usa o mesmo modelo como alternativa, com maior tempo de processamento. As fotos não são enviadas a servidores.

- **2×**: inferência nativa de 4× seguida de redução por média de área para 2×.
- **4×**: resolução nativa do modelo.
- Blocos de 128 px com sobreposição de 34 px cobrem todo o campo receptivo da rede. A transparência é preservada com interpolação do canal alfa.
- Saída limitada a **16 megapixels** e **8.192 px por lado**. Imagens que excedam esses limites recebem uma orientação para usar 2×, diminuir a origem ou desativar a melhoria; nenhuma foto é reduzida silenciosamente.
- **Cancelar processamento** interrompe a inferência e libera a interface. Em lotes, os arquivos já concluídos continuam disponíveis e os restantes podem ser retomados com a mesma ampliação.

A IA pode reconstruir detalhes diferentes do original. A melhora depende da imagem e não recupera informação perdida com certeza. Use a prévia para conferir o resultado. A opção começa desativada para manter a limpeza rápida de fotos que já têm resolução suficiente.

### Escolha do algoritmo

Não existe um melhor algoritmo para toda imagem e dispositivo. A escolha considera fotos com ruído/compressão, processamento local, tamanho do download e uso em lote. Foram consultadas as implementações e publicações oficiais:

| Alternativa | Avaliação para este site |
| --- | --- |
| [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) | Restauração de imagens reais; o modelo compacto `general-x4v3` permite denoising ajustável e exportação para ONNX. Escolhido pelo equilíbrio entre restauração e execução local. |
| [ESRGAN / UpscalerJS](https://upscalerjs.com/models/available/upscaling/esrgan-thick/) | Integração pronta em JavaScript e processamento por blocos; alternativa útil, mas optamos pelo treinamento do Real-ESRGAN voltado a degradações reais. |
| [SwinIR](https://github.com/JingyunLiang/SwinIR) e [HAT](https://github.com/XPixelGroup/HAT) | Transformers com resultados fortes de restauração; exigem avaliar modelos e custo de inferência maiores para este fluxo de navegador e lote. |
| [PLKSR / Real-PLKSR](https://github.com/dslisleedh/PLKSR) | Arquitetura eficiente promissora; os checkpoints e a integração devem ser avaliados conforme o domínio das fotos. |

Essa é uma escolha de engenharia para este produto, não um ranking universal nem um benchmark comparativo de qualidade visual. Mais detalhes científicos no [artigo Real-ESRGAN](https://arxiv.org/abs/2107.10833). Inferência local conforme a documentação do [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/).

### Reproduzir o modelo

`scripts/export-upscaler.py` baixa os dois checkpoints oficiais da release `v0.2.5.0`, combina seus parâmetros conforme a configuração padrão de denoise da ferramenta original, exporta ONNX opset 17 e compara sua saída com PyTorch. O script é uma ferramenta de desenvolvimento; não é executado pelo build do site. Instale `torch`, `onnx` e `onnxruntime` em um ambiente Python separado para executá-lo.

`public/models/provenance.json` registra URLs, hashes SHA-256, versão da arquitetura e erro máximo da comparação. A licença BSD-3-Clause acompanha o modelo em `public/models/LICENSE.txt`.

## Como funciona

- Lê EXIF, XMP, IPTC, ICC e blocos de texto no navegador.
- Exibe os campos encontrados antes da limpeza.
- Decodifica a imagem para pixels e gera um novo JPG, PNG ou WEBP sem copiar os blocos de metadados.
- Inspeciona novamente o arquivo final e só então libera o download.
- Não envia imagens para servidor algum.

Na tela inicial, clique em **Colar imagem** ou use **Ctrl + V** (**⌘ + V** no Mac) após copiar uma imagem. Ela será identificada, inspecionada e limpa automaticamente; o resultado fica disponível em **Baixar imagem limpa**. Colar texto ou um link não importa uma imagem. Se o navegador bloquear o acesso pelo botão, use o atalho de colar. A seleção de arquivos e o arraste continuam com a etapa de limpeza manual.

## Limpeza em lote

Selecione ou arraste de 2 a **100 fotos** JPG, PNG ou WEBP de até **25 MB por foto**. Clique em **Limpar fotos** para acompanhar o progresso de cada arquivo. O processamento ocorre uma foto por vez no navegador. Arquivos inválidos ou falhas individuais não interrompem as demais fotos.

Você pode selecionar todas de uma vez ou usar **Adicionar fotos** para montar o lote por etapas, inclusive uma foto por seleção. Arrastar novas fotos também acrescenta ao lote. As fotos anteriores e seus resultados já limpos são preservados; o ZIP é atualizado ao incluir novas imagens. **Substituir seleção** troca explicitamente todo o conjunto. O limite de 100 vale para o total acumulado.

Cada resultado verificado oferece **Baixar** individualmente. O botão **Baixar todas (.zip)** reúne as fotos limpas, com nomes únicos quando houver arquivos repetidos. Fotos com erro ficam fora do ZIP e podem ser tentadas novamente quando o formato e o tamanho forem válidos. O modo em lote utiliza a limpeza de metadados, sem as transformações do laboratório.

Se a melhoria de qualidade estiver ativa, ela é aplicada sequencialmente a cada foto. A ampliação fica fixa após o primeiro resultado do lote; para mudá-la, inicie um novo lote. O cancelamento mantém os resultados concluídos e permite continuar as demais fotos.

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

Imagens: JPG, PNG e WEBP de até 25 MB por foto, em lotes de até 100. GIF animado e HEIC não são aceitos porque a redecodificação no navegador pode perder quadros ou não ser suportada de forma consistente.

Vídeos: MP4, MOV e M4V convencionais de até 2 GB, um por vez, conforme as restrições descritas acima. Outros contêineres, como AVI, MKV e WEBM, não são aceitos.
