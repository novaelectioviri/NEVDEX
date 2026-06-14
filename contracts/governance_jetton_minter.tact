import "@stdlib/deploy";
import "./governance_jetton_messages.tact";
import "./governance_jetton_wallet.tact";

contract GovernanceJettonMinter with Deployable {
    owner: Address;
    totalSupply: Int as coins;
    content: Cell;
    walletAddressByOwner: map<Address, Address>;

    init(owner: Address, content: Cell) {
        self.owner = owner;
        self.totalSupply = 0;
        self.content = content;
    }

    receive(msg: MintGovernanceJettons) {
        require(sender() == self.owner, "JETTON_MINTER_NOT_OWNER");
        require(msg.amount > 0, "JETTON_MINT_ZERO");

        let walletInit = initOf GovernanceJettonWallet(msg.recipient, myAddress());
        let walletAddress = contractAddress(walletInit);

        send(SendParameters{
            to: walletAddress,
            value: ton("0.08"),
            mode: SendPayGasSeparately,
            bounce: false,
            body: WalletMint{
                queryId: msg.queryId,
                amount: msg.amount,
            }.toCell(),
            code: walletInit.code,
            data: walletInit.data,
        });

        self.totalSupply = self.totalSupply + msg.amount;
        self.walletAddressByOwner.set(msg.recipient, walletAddress);
    }

    receive() {}

    get fun owner(): Address {
        return self.owner;
    }

    get fun totalSupply(): Int {
        return self.totalSupply;
    }

    get fun content(): Cell {
        return self.content;
    }

    get fun getWalletAddress(owner: Address): Address {
        if (self.walletAddressByOwner.exists(owner)) {
            return self.walletAddressByOwner.get(owner)!!;
        }
        let walletInit = initOf GovernanceJettonWallet(owner, myAddress());
        return contractAddress(walletInit);
    }
}
