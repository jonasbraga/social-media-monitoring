import { NestFactory } from '@nestjs/core';
import { SocialMediaModule } from './social-media/social-media.module';

async function bootstrap() {
  const app = await NestFactory.create(SocialMediaModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
