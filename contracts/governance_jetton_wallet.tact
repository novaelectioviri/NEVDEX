import "./governance_jetton_messages.tact";

contract GovernanceJettonWallet {
    owner: Address;
    master: Address;
    balance: Int as coins;

    init(owner: Address, master: Address) {
        self.owner = owner;
        self.master = master;
        self.balance = 0;
    }

    receive(msg: WalletMint) {
        require(sender() == self.master, "JETTON_MASTER_ONLY");
        self.balance = self.balance + msg.amount;
    }

    receive(msg: WalletCredit) {
        let expectedSenderInit = initOf GovernanceJettonWallet(msg.fromOwner, self.master);
        let expectedSender = contractAddress(expectedSenderInit);
        require(sender() == expectedSender, "JETTON_WALLET_ONLY");
        self.balance = self.balance + msg.amount;

        if (msg.forwardTonAmount > 0) {
            send(SendParameters{
                to: self.owner,
                value: msg.forwardTonAmount,
                mode: SendPayGasSeparately,
                bounce: false,
                body: JettonTransferNotification{
                    queryId: msg.queryId,
                    amount: msg.amount,
                    sender: msg.fromOwner,
                    forwardPayload: msg.forwardPayload,
                }.toCell(),
            });
        }
    }

    receive(msg: JettonTransfer) {
        require(sender() == self.owner, "JETTON_OWNER_ONLY");
        require(msg.amount > 0, "JETTON_AMOUNT_ZERO");
        require(self.balance >= msg.amount, "JETTON_BALANCE_LOW");

        self.balance = self.balance - msg.amount;

        let targetInit = initOf GovernanceJettonWallet(msg.destination, self.master);
        let targetAddress = contractAddress(targetInit);

        send(SendParameters{
            to: targetAddress,
            value: ton("0.06"),
            mode: SendPayGasSeparately,
            bounce: false,
            body: WalletCredit{
                queryId: msg.queryId,
                amount: msg.amount,
                fromOwner: self.owner,
                forwardTonAmount: msg.forwardTonAmount,
                forwardPayload: msg.forwardPayload,
            }.toCell(),
            code: targetInit.code,
            data: targetInit.data,
        });
    }

    receive() {}

    get fun owner(): Address {
        return self.owner;
    }

    get fun master(): Address {
        return self.master;
    }

    get fun balance(): Int {
        return self.balance;
    }
}
