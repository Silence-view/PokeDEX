# PokeDex

## Setup
First, follow the instructions from the link below to install anchor:

[Instructions to Install Anchor](https://www.anchor-lang.com/docs/installation)

Then, setup your Solana Wallet using:

```
solana-keygen new
```

Then run the following commands to fund the wallet:

```
solana config set -ud
solana airdrop 2
```

Finally, set the Solana CLI config to use localhost:

```
solana config set -ul
```


## Building Program

Use the following command to build the program:

```
anchor build
```

## Deploying Program
When using the localhost to deploy the program, first run the following command in a terminal window:

```
solana-test-validator
```

Then in a new terminal window, run:

```
anchor deploy
```

## Testing Program
Run the following command to run the test suite:

```
anchor test
```