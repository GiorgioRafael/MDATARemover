O CleanFrame remove metadados de fotos e vídeos no próprio arquivo, sem upload, geração de imagens ou recompressão.

### Instalar

- **Windows comum (Intel/AMD):** baixe o arquivo que termina em `win-x64.exe` e execute. A instalação é feita no seu usuário, com atalho no menu Iniciar.
- **Windows ARM:** escolha o arquivo que termina em `win-arm64.exe`.
- **Mac com Apple Silicon (M1 ou posterior):** abra o arquivo `mac-arm64.dmg` e arraste o CleanFrame para Aplicativos.
- **Mac com Intel:** escolha `mac-x64.dmg` e arraste o CleanFrame para Aplicativos.

Não é necessário instalar Node.js, Python, FFmpeg ou ExifTool. Depois de instalado, o aplicativo funciona offline. Os pacotes Windows não têm certificado de distribuição; os pacotes macOS usam assinatura ad hoc e não são notarizados pela Apple. O sistema pode solicitar confirmação de procedência. Use somente os arquivos desta release e respeite as políticas de segurança do seu computador.

### Usar

Abra o CleanFrame, arraste imagens ou vídeos, confira o caminho e clique em **Remover metadados**. O arquivo é atualizado no mesmo local. O botão **Conectar MCP** copia a configuração para seu assistente.

Formatos: JPG/JPEG, PNG, WebP e MP4/MOV/M4V convencionais. Informações técnicas necessárias para reproduzir a mídia podem permanecer; o programa informa os limites na interface e recusa estruturas incompatíveis.

Os hashes dos instaladores estão em `SHA256SUMS.txt`.
