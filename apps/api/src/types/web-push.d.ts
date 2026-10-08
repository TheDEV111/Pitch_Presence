declare module 'web-push' {
  const webpush: {
    sendNotification(
      subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
      payload: string,
      options: {
        vapidDetails: { subject: string; publicKey: string; privateKey: string };
        TTL: number;
        timeout: number;
        contentEncoding: 'aes128gcm';
        topic: string;
      },
    ): Promise<{ statusCode: number }>;
  };
  export default webpush;
}
