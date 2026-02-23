import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PipelinesListComponent } from './pipelines-list.component';

describe('PipelinesListComponent', () => {
  let component: PipelinesListComponent;
  let fixture: ComponentFixture<PipelinesListComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [PipelinesListComponent]
    });
    fixture = TestBed.createComponent(PipelinesListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
