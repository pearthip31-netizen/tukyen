// ฟังก์ชันดึงข้อมูลอาหารจาก Backend และแสดงผลเป็นการ์ดลงหน้าเว็บ
async function fetchFridgeItems() {
  try {
    const response = await fetch('http://localhost:3000/api/foods');
    const foods = await response.json();
    
    console.log('ข้อมูลรายการอาหารจากฐานข้อมูล Neon:', foods);
    
    // ค้นหาตำแหน่งกล่องที่แสดงรายการอาหาร (ปรับ Selector ให้ตรงกับกล่องรายการของคุณ)
    const foodContainer = document.querySelector('main');
    
    if (foodContainer) {
      if (foods.length === 0) {
        // ถ้าในฐานข้อมูลไม่มีข้อมูล ให้แสดงข้อความว่าไม่มีรายการอาหาร
        foodContainer.innerHTML = '<p class="text-center text-slate-400 py-8">ตู้เย็นว่างเปล่า ไม่มีรายการอาหารในขณะนี้</p>';
      } else {
        let htmlContent = '';
        
        // วนลูปสร้างการ์ดจากข้อมูลจริงในฐานข้อมูล Neon
        foods.forEach(food => {
          htmlContent += `
            <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 flex justify-between items-center mb-4">
              <div>
                <h3 class="text-white font-bold text-lg">${food.name}</h3>
                <p class="text-slate-400 text-sm">หมวดหมู่: ${food.category || 'ทั่วไป'} | โน้ต: ${food.note || '-'}</p>
              </div>
              <div class="text-right">
                <span class="text-yellow-400 text-sm font-semibold">หมดอายุ: ${food.expiry_date}</span>
              </div>
            </div>
          `;
        });
        
        // แทนที่ข้อมูลเดิมด้วยข้อมูลจริงจากฐานข้อมูล
        // (หรือถ้าอยากให้แสดงเฉพาะจุด ให้ระบุ Class ของกล่องรายการอาหารแทนคำว่า main)
        foodContainer.innerHTML = htmlContent;
        console.log(`เรนเดอร์รายการอาหารสำเร็จ ${foods.length} รายการ`);
      }
    }

  } catch (error) {
    console.error('เกิดข้อผิดพลาดในการเชื่อมต่อ:', error);
  }
}

// เรียกใช้งานฟังก์ชันเมื่อเปิดหน้าเว็บ
fetchFridgeItems();