# SPF Tracking: ตาราง Hourly Output

เอกสารสรุปสำหรับพัฒนาต่อ ครอบคลุมที่มาของตัวเลขในตาราง Hourly Output ของหน้า Sewing Performance Tracking (SPF Tracking), สูตรที่ใช้, แนวคิด, และสื่อการสอนที่สร้างไว้

## 1. เป้าหมาย

- อธิบายว่าแต่ละช่องในตาราง Hourly Output คำนวณอย่างไร (TARGET LOAD, ACTUAL LOAD, HOURLY TARGET, QC PASS, BALANCE WIP, SCAN BOX และแถว Summary)
- สร้างสื่อการสอนแบบ web interactive (HTML ไฟล์เดียว) ที่แก้ตัวเลขแล้วค่าอื่นขยับตามทันที พร้อมอธิบายสูตรและเหตุผล

## 2. สถาปัตยกรรมของหน้า

| รายการ | รายละเอียด |
|---|---|
| Frontend | React (build แล้ว `main.<hash>.js`) route `/SPFTracking/:param?` เช่น `/SPFTracking/G1-012` |
| Component หลัก | lazy chunk หมายเลข 8520 (`static/js/8520.<hash>.chunk.js`) |
| Component ตาราง | ฟังก์ชัน `R({periods, initialBalance})` ใน chunk 8520 (class `spf-hourly-table`) |
| การรับข้อมูล | WebSocket `wss://ndes-ws.nanyangtextile.com/ws/spftracking` (local: `ws://127.0.0.1:8002`) |
| ข้อความขาขึ้น | `{"type":"joinRoom","bu":"G1","lineNo":"012"}` |
| ข้อความขาลง | `{"type":"receiveData","success":true,"bu","lineNo","data":[...SO...],"pushedAt"}` |
| ตัวคำนวณจริง | อยู่ฝั่ง Node backend ที่สร้าง `receiveData` ไม่อยู่ใน frontend |

หน้าเว็บคำนวณเองเฉพาะ: Target Load, Balance WIP, ลูกศรผลต่างสะสม, สีของตัวเลข, Summary
ค่าที่ server ส่งมาเป็นสำเร็จรูป: `period_target` (รวมยอดเพิ่มแล้ว), `period_wip_line` (Actual Load), `period_qc_pass`, `period_fn_qty`, `opening_wip_in_line`

หมายเหตุ: ถ้าเลือก SO = All หน้าเว็บจะรวม `periods` ของทุก SO ก่อนแสดง (ฟังก์ชันรวม periods ใน chunk 8520)

## 3. ข้อมูลนำเข้า (field ใน `data[].periods[คีย์เวลาสิ้นคาบ]`)

| Field | ความหมาย |
|---|---|
| `start_time`, `end_time` | ช่วงเวลาของคาบ |
| `period_base_target` | เป้าพื้นฐานของคาบ |
| `period_target_extra` | ยอดเพิ่มที่ server ปรับเพิ่ม |
| `period_target` | เป้าที่ใช้แสดง = base + extra |
| `period_target_adjusted` | true เมื่อมียอดเพิ่ม (หน้าเว็บแสดงสีเหลือง) |
| `period_wip_line` | Actual Load (งานโหลดเข้าสาย) |
| `period_good`, `period_defect_pass` | QC Pass, Reprocess |
| `period_qc_pass` | QC Pass + Reprocess |
| `period_fn_qty` | ยอด Scan Box (FN) |
| `period_work_minutes` | นาทีที่ทำงานจริงจนถึงตอนนี้ |
| `time_minutes` | นาทีที่กำหนดของคาบ (ใช้ในสูตรยอดเพิ่ม) |
| `period_is_preview` | คาบถัดไปที่แสดงล่วงหน้า (แสดง "-" และไม่นับรวม) |

ระดับ SO: `opening_wip_in_line` (WIP เริ่มวัน), `calculated_wip_in_line` (WIP ที่คำนวณได้), `wip_in_line` (WIP อีกวิธีนับ), `target_per_day`, `current_work_mins`, `hourly_target_source` (= "server")

## 4. สูตร

ให้แถว i, `prevBal` = Balance ของแถวก่อนหน้า (แถวแรกใช้ `opening_wip_in_line`)

### 4.1 สูตรจากโค้ดหน้าเว็บ (ตรงกับข้อมูลจริงทุกค่า)

```
TARGET LOAD   = round( max(0, HOURLY TARGET − prevBal) × 1.25 )
ACTUAL LOAD   = period_wip_line
HOURLY TARGET = period_target
QC PASS       = period_qc_pass   (ถ้าไม่มี = period_good + period_defect_pass)
BALANCE WIP   = prevBal + ACTUAL LOAD − QC PASS
SCAN BOX      = period_fn_qty

ลูกศร QC PASS  = ΣQC สะสมถึงแถวนี้ − ΣHOURLY TARGET สะสมถึงแถวนี้
ลูกศร SCAN BOX = ΣScan สะสมถึงแถวนี้ − ΣHOURLY TARGET สะสมถึงแถวนี้
   (ลบ = สีแดง ลูกศรลง, บวก = สีเขียว ลูกศรขึ้น, 0 = ไม่แสดง)

Summary: TARGET LOAD, ACTUAL LOAD, HOURLY TARGET, QC PASS, SCAN BOX = ผลรวมทุกแถว
         BALANCE WIP = ค่าของแถวสุดท้าย (ไม่บวกรวม)
         แถว preview ไม่นับรวม และไม่ตัด Balance
```

### 4.2 กฎสี

- ACTUAL LOAD: `load < targetLoad` เป็น low (ฟ้าในสื่อสอน), `load > 1.25 × targetLoad` เป็น high (ส้ม), อื่นๆ ขาว
  - เมื่อ Target Load = 0 และ Load > 0 จะเป็นส้ม
- HOURLY TARGET: เหลืองเมื่อ `period_target_adjusted` หรือ extra > 0
- QC PASS / SCAN BOX: ตัวเลขหลักเป็นเขียวเมื่อ `value > 0 และ value ≥ HOURLY TARGET`

### 4.3 สูตรยอดเพิ่ม (`period_target_extra`) ที่ถอดจากข้อมูล

คำนวณที่ server ไม่ใช่หน้าเว็บ สูตรนี้ได้จากการอนุมานจากข้อมูลสาย 012 ไม่ใช่โค้ดจริง

```
shortfall = max(0, Σ base target ของคาบก่อนหน้า − Σ QC ของคาบก่อนหน้า)
extra     = round( shortfall × time_minutes ของคาบนี้ ÷ Σ time_minutes ตั้งแต่คาบนี้ถึงท้ายวัน )
HOURLY TARGET = base + extra
```

แนวคิด: ยอดที่ QC ขาดเป้าสะสมถูกกระจายไปตามเวลาที่เหลือ ยิ่งใกล้สิ้นวันยอดเพิ่มยิ่งสูง

ผลเทียบกับค่าจริง (สาย 012):

| คาบ | ขาดสะสม | นาที/เหลือ | สูตรได้ | ระบบจริง |
|---|---|---|---|---|
| 09-10 | 50 | 60/420 | 7.14 → 7 | 7 ✓ |
| 10-11 | 78 | 60/360 | 13.00 → 13 | 13 ✓ |
| 11-12 | 110 | 30/300 | 11.00 → 11 | 11 ✓ |
| 12-13 | 129 | 30/270 | 14.33 → 14 | 15 ✗ |
| 13-14 | 117 | 60/240 | 29.25 → 29 | 30 ✗ |
| 14-15 | 130 | 60/180 | 43.33 → 43 | 43 ✓ |
| 15-16 | 158 | 60/120 | 79.00 → 79 | 80 ✗ |
| 16-17 | 190 | 60/60 | 190.00 → 190 | 189 ✗ |

ตรง 5 จาก 9 คาบ (รวมคาบแรกที่ extra = 0) ที่เหลือต่าง ±1 ทิศทางไม่คงที่

ข้อสังเกต:
- ใช้ `time_minutes` (กำหนดเต็ม 60/30) ไม่ใช่ `period_work_minutes` เพราะคาบสุดท้ายมี work_minutes = 4 (ยังไม่ครบ) แต่ผลรวม `time_minutes` ทั้งวัน = 480
- เป้าพื้นฐานรวม 600/วัน = 75 × 8 ชม. แต่คาบ 30 นาทีได้ 35 และ 40 (รวม 75) ยังไม่พบกฎแบ่ง 35/40
- กรณีตารางสายที่เป้า 30/ชม. (ภาพแรก, ยอดเพิ่ม 1, 3, 5, 9, 13, 25) ยังไม่ได้เทียบกับสูตรนี้ เพราะยังไม่มี JSON ของสายนั้น

## 5. ข้อมูลตัวอย่างที่ใช้ยืนยัน (G1 สาย 012, SO 264741, 09/11/2569)

`opening_wip_in_line` = 172, เป้า 600/วัน

| คาบ | นาที | Base | Extra | Target | Load | QC | Scan | Balance |
|---|---|---|---|---|---|---|---|---|
| 08-09 | 60 | 75 | 0 | 75 | 82 | 25 | 39 | 229 |
| 09-10 | 60 | 75 | 7 | 82 | 207 | 47 | 44 | 389 |
| 10-11 | 60 | 75 | 13 | 88 | 0 | 43 | 40 | 346 |
| 11-12 | 30 | 35 | 11 | 46 | 0 | 16 | 0 | 330 |
| 12-13 | 30 | 40 | 15 | 55 | 209 | 52 | 80 | 487 |
| 13-14 | 60 | 75 | 30 | 105 | 107 | 62 | 0 | 532 |
| 14-15 | 60 | 75 | 43 | 118 | 0 | 47 | 80 | 485 |
| 15-16 | 60 | 75 | 80 | 155 | 89 | 43 | 80 | 531 |
| 16-17 | 60 | 75 | 189 | 264 | 0 | 2 | 0 | 529 |
| Summary | | 600 | | 988 | 694 | 337 | 363 | 529 |

ลูกศร: QC สะสมสุดท้าย 337 − 988 = −651, Scan 363 − 988 = −625

Balance แถวสุดท้าย (529) ตรงกับ `calculated_wip_in_line` = 529

## 6. ประเด็นที่ยังเปิดอยู่

1. **สูตรจริงของ `period_target_extra`** อยู่ใน Node backend (ค้นคำว่า `period_target_extra`, `period_base_target`) เพื่อแทนสูตรอนุมานในข้อ 4.3 และอธิบายส่วนต่าง ±1 (สมมติฐาน: server คิดตอนต้นคาบด้วย QC ณ เวลานั้นแล้วเก็บค่า ยังไม่ยืนยัน)
2. **ที่มาของ `period_wip_line` (Actual Load)** ยังไม่ทราบว่านับจากตาราง/event ใด
3. **กฎแบ่งเป้าคาบ 30 นาที** (35/40 จากเป้า 75)
4. **Front-Line 445 กับ Balance WIP 529 ไม่เท่ากัน** มาจาก `wip_in_line` และ `calculated_wip_in_line` ต่างกัน 84 ชิ้น ควรถามผู้พัฒนาว่าค่าไหนคือค่าอ้างอิง
5. **Balance ใช้ QC PASS ไม่ใช่ Scan Box** วันตัวอย่าง Scan 363 สูงกว่า QC 337 อยู่ 26 ชิ้น ต้องยืนยันว่าตั้งใจ
6. **Tooltip ใน HTML build เก่า** เขียนว่า `Target/Hr 30 − Previous Balance` ส่วน build ปัจจุบันใช้ `Round(max(0, Hourly Target − Previous Balance) × 1.25)` ต้องระวังเวอร์ชันของ build เมื่ออ้างอิง
7. **Snapshot ไม่พร้อมกัน** ภาพกับ HTML ที่ส่งมาในช่วงแรก (สายเป้า 30/ชม.) มีคาบ 15:00-16:00 ต่างกัน (QC 12 กับ 13) เป็นข้อมูลต่างเวลา ไม่ใช่สูตรต่างกัน

## 7. สื่อการสอน `spf-hourly-teaching.html`

ไฟล์ HTML ไฟล์เดียว ไม่พึ่งไลบรารีภายนอก

- จำลองตารางตามภาพ (สีพื้นกรมท่า, หัวตารางเทา, Hourly Output ฟ้า, เป้าที่ปรับแล้วเหลือง, Actual Load สูงเป็นส้ม, ลูกศรแดง)
- ช่องที่แก้ได้ในตาราง: ACTUAL LOAD, QC PASS, SCAN BOX
- ค่าตั้งต้นแก้ได้ใต้ตาราง: Opening WIP, นาทีของแต่ละคาบ, เป้าพื้นฐานของแต่ละคาบ
- คลิกช่องใดก็ได้: แผงขวาแสดงสูตร, การแทนค่าตัวเลขจริง, เหตุผล, และไฮไลต์ช่องที่ถูกใช้คิด
- ปุ่มสาธิต: รีเซ็ต, Opening WIP = 0, QC = เป้า, QC = 0
- ช่องติ๊กเปรียบเทียบ Hourly Target กับค่าจริงจากระบบ (ใช้ได้เมื่อ base, minutes, QC ยังเป็นค่าตัวอย่าง)

โครงโค้ด:
- `DEF` ข้อมูลตั้งต้นสาย 012 (รวมค่า `srv` = extra จริงจาก server ใช้เทียบ)
- `calc()` คำนวณทุกช่อง (ยอดเพิ่ม, Target Load, Balance, ผลรวมสะสม, ลูกศร, Summary)
- `build()` สร้าง DOM ครั้งเดียว, `update()` อัปเดตค่าโดยไม่สร้างใหม่ (ไม่ทำให้ช่อง input เสีย focus)
- `paint()` ไฮไลต์ช่องที่เลือกและช่องที่เกี่ยวข้อง, `explain()` สร้างคำอธิบายรายช่อง
- ถ้าพบสูตร extra จริง ให้แก้ที่ `calc()` (บรรทัดที่คำนวณ `raw` และ `extra`) และคำอธิบายในกรณี `c==='tgt'` ของ `explain()`

## 8. ข้อควรระวังเรื่องข้อมูล

- JSON จาก WebSocket มีชื่อและรหัสพนักงานใน `bullet_payload`, `chart_operator`, `worker` ก่อนแชร์หรือส่งต่อให้ตัดออก ส่วนที่ต้องใช้คิดตารางนี้คือ `periods` และ `opening_wip_in_line`
- ไฟล์ build ของ production (`main.js`, chunk) ใช้อ้างอิงโครงสร้างได้ แต่ชื่อ hash เปลี่ยนทุกครั้งที่ deploy

## 9. ขั้นตอนต่อไปที่แนะนำ

1. เข้าถึงโค้ด Node backend แล้วหาสูตร `period_target_extra` และ `period_wip_line`
2. ขอ JSON ของสายที่เป้า 30/ชม. เพื่อทดสอบสูตรยอดเพิ่มกับข้อมูลชุดที่สอง
3. ปรับ `calc()` ในสื่อการสอนให้ตรง 100% แล้วเพิ่มกรณีทดสอบ (คาบ 30 นาที, QC เกินเป้า, SO หลายตัว)
4. พิจารณาเพิ่มโหมดอธิบายการรวม SO (เลือก All) และแถว preview
