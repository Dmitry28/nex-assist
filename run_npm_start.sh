#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

cd /Users/dmitrypoluyan/dp/my/land_scrapper
npm start >> /Users/dmitrypoluyan/dp/my/land_scrapper/cron.log 2>&1
