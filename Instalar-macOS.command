#!/bin/sh
set -u

installation_failed() {
  cleanframe_exit="$1"
  printf '\nA instalação foi interrompida. %s\n' "$2" >&2
  if [ -t 0 ]; then
    printf 'Pressione Enter para fechar… '
    IFS= read -r cleanframe_reply || true
  fi
  exit "$cleanframe_exit"
}

cleanframe_directory=$(CDPATH= cd -P "$(dirname "$0")" && pwd) || exit 1
cd "$cleanframe_directory" || installation_failed 1 'Não foi possível abrir a pasta do projeto.'

if [ "$(uname -s)" != 'Darwin' ]; then
  installation_failed 1 'Este arquivo é destinado ao macOS.'
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  installation_failed 1 'Instale Node.js 24 ou superior com npm em https://nodejs.org/en/download e tente novamente.'
fi
if ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"; then
  installation_failed 1 'Atualize para Node.js 24 ou superior em https://nodejs.org/en/download e tente novamente.'
fi

printf 'Instalando as dependências do CleanFrame…\n'
npm ci
cleanframe_exit=$?
if [ "$cleanframe_exit" -ne 0 ]; then
  installation_failed "$cleanframe_exit" 'Confira a mensagem do npm acima.'
fi

printf '\nCompilando e abrindo o instalador do CleanFrame…\n'
npm run desktop:install
cleanframe_exit=$?
if [ "$cleanframe_exit" -ne 0 ]; then
  installation_failed "$cleanframe_exit" 'Confira a mensagem acima.'
fi

printf '\nArraste CleanFrame para Aplicativos na janela de instalação.\n'
