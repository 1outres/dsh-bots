declare function mintSpaceToken(): { token: string; hash: string }

export const issue = () => mintSpaceToken()
