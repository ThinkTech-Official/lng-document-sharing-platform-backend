import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: Number(process.env.MAIL_PORT) || 587,
      secure: process.env.MAIL_SECURE === 'true',
      // requireTLS forces STARTTLS on port 587 (required by Mailtrap sandbox)
      requireTLS: process.env.MAIL_SECURE !== 'true',
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });
  }

  private get from() {
    return `"${process.env.MAIL_FROM_NAME ?? 'LNG Platform'}" <${process.env.MAIL_FROM ?? process.env.MAIL_USER}>`;
  }

  async sendPasswordResetLink(to: string, token: string): Promise<void> {
    const link = `${process.env.APP_URL}/auth/reset-password?token=${token}`;
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: 'Reset your password',
      html: `
        <p>You requested a password reset. Click the link below to set a new password.</p>
        <p>This link expires in <strong>15 minutes</strong> and can only be used once.</p>
        <p><a href="${link}">Reset my password</a></p>
        <p>If you did not request this, you can safely ignore this email.</p>
      `,
    });
    this.logger.log(`Password reset link sent to ${to}`);
  }

  async sendTempPassword(
    to: string,
    name: string,
    tempPassword: string,
    subject: string = 'Your LNG Platform Account Has Been Created',
  ): Promise<void> {
    const resetUrl = `${process.env.APP_URL}/auth/change-password`;
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject,
      html: `
        <p>Hi ${name},</p>
        <p>Your account has been created on the LNG Document Sharing Platform.</p>
        <p><strong>Email:</strong> ${to}</p>
        <p><strong>Temporary Password:</strong> ${tempPassword}</p>
        <p>For security, you must change your password on first login.</p>
        <p>Login and use this endpoint to set a new password:</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>If you did not expect this email, please contact your administrator.</p>
      `,
    });
    this.logger.log(`Temporary password sent to ${to}`);
  }
}
