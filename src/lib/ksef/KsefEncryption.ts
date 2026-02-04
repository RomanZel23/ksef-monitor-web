import * as crypto from 'crypto';

export class KsefEncryption {
  /**
   * Encrypts the authorization token combined with the challenge timestamp.
   * KSeF requires the token to be encrypted using the environment's public key.
   * Format: RSA_ECB_PKCS1( token + "|" + challengeTimestamp )
   * 
   * @param token The user's KSeF Authorization Token.
   * @param challengeTimestamp The timestamp received from the AuthorisationChallenge endpoint.
   * @param publicKeyPem The KSeF environment's public key (PEM format).
   */
  static encryptToken(token: string, challengeTimestamp: string, publicKeyPem: string): string {
    const message = `${token}|${challengeTimestamp}`;
    const buffer = Buffer.from(message, 'utf-8');

    const encrypted = crypto.publicEncrypt(
      {
        key: publicKeyPem,
        padding: crypto.constants.RSA_PKCS1_PADDING,
      },
      buffer
    );

    return encrypted.toString('base64');
  }
}
