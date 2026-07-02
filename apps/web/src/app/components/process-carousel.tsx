"use client";

import { useEffect, useRef } from "react";

const steps = [
  {
    number: "01",
    title: "Выбор букета",
    text: "Клиент выбирает букет, дату, интервал и способ связи."
  },
  {
    number: "02",
    title: "Подтверждение",
    text: "Менеджер проверяет заказ и согласовывает детали."
  },
  {
    number: "03",
    title: "Сборка",
    text: "Флорист собирает букет и прикладывает фото перед доставкой."
  },
  {
    number: "04",
    title: "Доставка",
    text: "Курьер видит маршрут, адрес, время и меняет статус заказа."
  }
];

export function ProcessCarousel() {
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let index = 0;

    const timer = window.setInterval(() => {
      const track = trackRef.current;

      if (!track || window.innerWidth > 940) {
        return;
      }

      const cards = Array.from(track.querySelectorAll<HTMLElement>(".step-card"));

      if (cards.length === 0) {
        return;
      }

      index = (index + 1) % cards.length;

      track.scrollTo({
        left: cards[index]?.offsetLeft ?? 0,
        behavior: "smooth"
      });
    }, 3200);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <section id="process" className="section process-carousel">
      <div className="section-heading">
        <span>Как проходит заказ</span>
        <h2>Прозрачно для клиента и удобно для команды</h2>
      </div>

      <div className="steps-grid steps-track" ref={trackRef} aria-label="Этапы заказа">
        {steps.map((step) => (
          <div className="step-card" key={step.number}>
            <span>{step.number}</span>
            <strong>{step.title}</strong>
            <p>{step.text}</p>
          </div>
        ))}
      </div>

    </section>
  );
}
