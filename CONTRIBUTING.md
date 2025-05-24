# Contributing

## Setup
```bash
git clone https://github.com/jahwag/cws.git
cd cws

# Configure OAuth (optional)
cp docker/.env.example docker/.env
# Edit docker/.env with your OAuth credentials

./install.sh --local --with-ssh
```

## Rebuild & restart
```bash
./docker/restart.sh
```

http://localhost:8080