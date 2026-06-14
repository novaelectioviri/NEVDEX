message MintGovernanceJettons {
    queryId: Int as uint64;
    recipient: Address;
    amount: Int as coins;
}

message WalletMint {
    queryId: Int as uint64;
    amount: Int as coins;
}

message WalletCredit {
    queryId: Int as uint64;
    amount: Int as coins;
    fromOwner: Address;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

message(0x0f8a7ea5) JettonTransfer {
    queryId: Int as uint64;
    amount: Int as coins;
    destination: Address;
    responseDestination: Address;
    customPayload: Cell?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

message(0x7362d09c) JettonTransferNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    forwardPayload: Slice as remaining;
}
